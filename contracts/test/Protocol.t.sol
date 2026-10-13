// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {AppKeyRegistry} from "../src/AppKeyRegistry.sol";
import {Signup} from "../src/Signup.sol";
import {FollowGraph} from "../src/FollowGraph.sol";
import {FeedRegistry} from "../src/FeedRegistry.sol";
import {Payments} from "../src/Payments.sol";
import {Anchor} from "../src/Anchor.sol";
import {CommunityRegistry} from "../src/CommunityRegistry.sol";
import {ScoutRegistry} from "../src/ScoutRegistry.sol";
import {AdminPriceOracle} from "../src/periphery/AdminPriceOracle.sol";
import {TestStable} from "../src/periphery/TestStable.sol";
import {FidAuth} from "../src/base/FidAuth.sol";
import {Scopes, KeyTypes} from "../src/base/Scopes.sol";

contract ProtocolTest is Test {
    ERC2771Forwarder fwd;
    IdentityRegistry identity;
    AppKeyRegistry appKeys;
    Signup signup;
    FollowGraph follows;
    FeedRegistry feeds;
    Payments payments;
    Anchor anchorC;
    CommunityRegistry communities;
    ScoutRegistry scouts;
    AdminPriceOracle oracle;
    TestStable tusd;

    address admin = makeAddr("admin");
    address relay = makeAddr("relay");

    uint256 aliceCustodyPk = 0xA11CE;
    uint256 aliceKeyPk = 0xA11CE2;
    uint256 bobCustodyPk = 0xB0B;
    uint256 bobKeyPk = 0xB0B2;

    uint256 alice;
    uint256 bob;

    function setUp() public {
        fwd = new ERC2771Forwarder("MonSocForwarder");
        identity = new IdentityRegistry(address(fwd), admin);
        appKeys = new AppKeyRegistry(address(fwd), address(identity), admin);
        signup = new Signup(address(identity), address(appKeys));
        follows = new FollowGraph(address(fwd), address(identity), address(appKeys), admin);
        feeds = new FeedRegistry(address(fwd), address(identity), address(appKeys), admin);
        payments = new Payments(address(fwd), address(identity), address(appKeys), address(feeds), admin, 1 days);
        anchorC = new Anchor(address(fwd), address(identity), address(appKeys), admin);
        communities = new CommunityRegistry(address(fwd), address(identity), address(appKeys), address(payments), admin);
        scouts = new ScoutRegistry(admin);
        oracle = new AdminPriceOracle(admin, 2e8); // 1 MON = $2
        tusd = new TestStable(address(fwd));

        vm.startPrank(admin);
        identity.setTrustedCaller(address(signup), true);
        appKeys.setTrustedCaller(address(signup), true);
        payments.setModule(address(communities), true);
        payments.setAcceptedToken(address(tusd), true);
        payments.setOracle(address(oracle));
        payments.setDistributor(relay, true);
        scouts.setPublisher(relay, true);
        vm.stopPrank();

        alice = _signup(aliceCustodyPk, aliceKeyPk, "alice", Scopes.FULL);
        bob = _signup(bobCustodyPk, bobKeyPk, "bob", Scopes.FULL);
    }

    // ------------------------------------------------------------------ helpers

    function _signup(uint256 custodyPk, uint256 keyPk, string memory handle, uint32 scope) internal returns (uint256) {
        address custody = vm.addr(custodyPk);
        bytes memory key = abi.encodePacked(vm.addr(keyPk));
        Signup.Params memory p = Signup.Params({
            custody: custody,
            recovery: address(0xBEEF),
            handle: handle,
            keyType: KeyTypes.SECP256K1,
            key: key,
            scope: scope,
            expiry: 0,
            clientFid: 0,
            deadline: block.timestamp + 1 hours
        });
        bytes32 structHash = keccak256(
            abi.encode(
                signup.SIGNUP_TYPEHASH(),
                p.custody,
                p.recovery,
                keccak256(bytes(p.handle)),
                p.keyType,
                keccak256(p.key),
                p.scope,
                p.expiry,
                p.clientFid,
                signup.nonces(custody),
                p.deadline
            )
        );
        bytes32 digest = _typedDigest(address(signup), "MonSocSignup", structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(custodyPk, digest);
        vm.prank(relay); // relay pays gas
        return signup.signupFor(p, abi.encodePacked(r, s, v));
    }

    function _typedDigest(address verifying, string memory name, bytes32 structHash) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256("1"),
                block.chainid,
                verifying
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    /// @dev App key signs a forward request; relay submits and pays gas.
    function _relay(uint256 keyPk, address to, bytes memory data, uint256 value) internal {
        address from = vm.addr(keyPk);
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
                ),
                from,
                to,
                value,
                uint256(1_000_000),
                fwd.nonces(from),
                deadline,
                keccak256(data)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keyPk, _typedDigest(address(fwd), "MonSocForwarder", structHash));
        ERC2771Forwarder.ForwardRequestData memory req = ERC2771Forwarder.ForwardRequestData({
            from: from,
            to: to,
            value: value,
            gas: 1_000_000,
            deadline: deadline,
            data: data,
            signature: abi.encodePacked(r, s, v)
        });
        vm.deal(relay, relay.balance + value);
        vm.prank(relay);
        fwd.execute{value: value}(req);
    }

    // ------------------------------------------------------------------ identity

    function test_signupCreatesIdHandleAndKey() public view {
        assertEq(identity.custodyOf(alice), vm.addr(aliceCustodyPk));
        assertEq(identity.fidByHandle("alice"), alice);
        assertTrue(appKeys.isAuthorized(alice, vm.addr(aliceKeyPk), Scopes.POST | Scopes.FOLLOW));
        assertEq(appKeys.signerFid(vm.addr(aliceKeyPk)), alice);
    }

    function test_recoveryMovesId() public {
        address newCustody = makeAddr("newPasskey");
        vm.prank(address(0xBEEF));
        identity.recover(alice, newCustody);
        assertEq(identity.custodyOf(alice), newCustody);
        assertEq(identity.idOf(vm.addr(aliceCustodyPk)), 0);
    }

    function test_handleRules() public {
        assertFalse(identity.isValidHandle("Alice"));
        assertFalse(identity.isValidHandle("way_too_long_handle_x"));
        vm.prank(vm.addr(bobCustodyPk));
        vm.expectRevert(IdentityRegistry.HandleTaken.selector);
        identity.setHandle("alice");
    }

    // ------------------------------------------------------------------ follows

    function test_sponsoredFollowViaAppKey() public {
        _relay(aliceKeyPk, address(follows), abi.encodeCall(FollowGraph.follow, (alice, bob)), 0);
        assertTrue(follows.isFollowing(alice, bob));
        assertEq(follows.followerCount(bob), 1);
        assertEq(follows.followedAt(alice, bob), block.timestamp);
        // idempotent retry
        _relay(aliceKeyPk, address(follows), abi.encodeCall(FollowGraph.follow, (alice, bob)), 0);
        assertEq(follows.followerCount(bob), 1);
    }

    function test_followRequiresScope() public {
        uint256 carolKeyPk = 0xCA201;
        uint256 carol = _signup(0xCA20, carolKeyPk, "carol", Scopes.POST);
        vm.prank(vm.addr(carolKeyPk));
        vm.expectRevert(FidAuth.Unauthorized.selector);
        follows.follow(carol, bob);
    }

    function test_cannotFollowForOthers() public {
        vm.prank(vm.addr(bobKeyPk));
        vm.expectRevert(FidAuth.Unauthorized.selector);
        follows.follow(alice, bob);
    }

    function test_revokedKeyLosesAccess() public {
        vm.prank(vm.addr(aliceCustodyPk));
        appKeys.revoke(alice, abi.encodePacked(vm.addr(aliceKeyPk)));
        vm.prank(vm.addr(aliceKeyPk));
        vm.expectRevert(FidAuth.Unauthorized.selector);
        follows.follow(alice, bob);
    }

    function test_followRateLimit() public {
        vm.prank(admin);
        follows.setDailyLimit(1);
        vm.startPrank(vm.addr(aliceKeyPk));
        follows.follow(alice, bob);
        vm.expectRevert(FollowGraph.RateLimited.selector);
        follows.unfollow(alice, bob);
        vm.warp(block.timestamp + 1 days);
        follows.unfollow(alice, bob);
        vm.stopPrank();
        assertFalse(follows.isFollowing(alice, bob));
    }

    // ------------------------------------------------------------------ feeds + payments

    function _paidFeed() internal returns (uint256 feedId) {
        vm.prank(vm.addr(aliceKeyPk));
        feedId = feeds.create(alice, FeedRegistry.Kind.RuleBased, "ipfs://feed", keccak256("def"), 3e6, 6000, 1500);
    }

    function test_feedVersioning() public {
        uint256 id = _paidFeed();
        vm.prank(vm.addr(aliceKeyPk));
        feeds.update(id, "ipfs://feed2", keccak256("def2"));
        assertEq(feeds.getFeed(id).version, 2);
        vm.prank(vm.addr(bobKeyPk));
        vm.expectRevert(FidAuth.Unauthorized.selector);
        feeds.update(id, "x", 0);
    }

    function test_discoveryRangeEnforced() public {
        vm.prank(vm.addr(aliceKeyPk));
        vm.expectRevert(FeedRegistry.BadDiscovery.selector);
        feeds.create(alice, FeedRegistry.Kind.Hosted, "https://x", 0, 0, 0, 100);
    }

    function test_subscribeStableSplitsRevenue() public {
        uint256 id = _paidFeed();
        address payer = vm.addr(bobKeyPk);
        tusd.faucet(payer, 100e6);
        vm.startPrank(payer);
        tusd.approve(address(payments), type(uint256).max);
        payments.subscribe(bob, id, address(tusd), 1);
        vm.stopPrank();
        assertTrue(payments.isSubscribed(bob, id));
        assertEq(payments.balanceOf(alice, address(tusd)), 1.2e6); // 40% owner
        assertEq(payments.creatorPool(0, address(tusd)), 1.8e6); // 60% creators
    }

    function test_subscribeInMonViaForwarder() public {
        uint256 id = _paidFeed();
        uint256 cost = payments.quote(3e6, address(0)); // $3 at $2/MON = 1.5 MON
        assertEq(cost, 1.5 ether);
        address key = vm.addr(bobKeyPk);
        vm.deal(key, 0);
        _relay(bobKeyPk, address(payments), abi.encodeCall(Payments.subscribe, (bob, id, address(0), 1)), cost);
        assertTrue(payments.isSubscribed(bob, id));
        assertEq(payments.balanceOf(alice, address(0)), 0.6 ether);
    }

    function test_creatorPayoutMerkleClaim() public {
        test_subscribeStableSplitsRevenue();
        // two creators: bob 1.0, alice 0.5 of the 1.8 pool -> 0.3 rolls over
        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(uint256(0), address(tusd), bob, uint256(1e6)))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(uint256(0), address(tusd), alice, uint256(0.5e6)))));
        bytes32 root = leafA < leafB ? keccak256(abi.encode(leafA, leafB)) : keccak256(abi.encode(leafB, leafA));

        vm.prank(relay);
        vm.expectRevert(Payments.EpochNotOver.selector);
        payments.postPayoutRoot(0, address(tusd), root, 1.5e6, "");

        vm.warp(block.timestamp + 1 days);
        vm.prank(relay);
        payments.postPayoutRoot(0, address(tusd), root, 1.5e6, "ipfs://payouts/0");
        assertEq(payments.creatorPool(1, address(tusd)), 0.3e6);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        uint256 before = tusd.balanceOf(vm.addr(bobCustodyPk));
        payments.claim(0, address(tusd), bob, 1e6, proof);
        assertEq(tusd.balanceOf(vm.addr(bobCustodyPk)) - before, 1e6);
        vm.expectRevert(Payments.AlreadyClaimed.selector);
        payments.claim(0, address(tusd), bob, 1e6, proof);
    }

    function test_tipAndWithdraw() public {
        vm.deal(address(this), 1 ether);
        payments.tip{value: 1 ether}(bob, address(0), 1 ether);
        payments.withdraw(bob, address(0));
        assertEq(vm.addr(bobCustodyPk).balance, 1 ether);
    }

    // ------------------------------------------------------------------ communities

    function test_openCommunityAndBan() public {
        vm.prank(vm.addr(aliceKeyPk));
        uint256 cid = communities.create(alice, CommunityRegistry.JoinType.Open, address(0), 0, 0, 0, 0, "ipfs://c");
        vm.prank(vm.addr(bobKeyPk));
        communities.join(cid, bob);
        assertTrue(communities.isMember(cid, bob));
        assertEq(communities.getCommunity(cid).memberCount, 2);

        vm.prank(vm.addr(aliceKeyPk));
        communities.setBan(cid, alice, bob, true);
        assertFalse(communities.isMember(cid, bob));
        vm.prank(vm.addr(bobKeyPk));
        vm.expectRevert(CommunityRegistry.Banned.selector);
        communities.join(cid, bob);
    }

    function test_tokenGatedCommunity() public {
        vm.prank(vm.addr(aliceKeyPk));
        uint256 cid =
            communities.create(alice, CommunityRegistry.JoinType.TokenGated, address(tusd), 10e6, 0, 0, 0, "ipfs://c");
        vm.prank(vm.addr(bobKeyPk));
        vm.expectRevert(CommunityRegistry.GateNotMet.selector);
        communities.join(cid, bob);
        tusd.faucet(vm.addr(bobCustodyPk), 10e6);
        vm.prank(vm.addr(bobKeyPk));
        communities.join(cid, bob);
        assertTrue(communities.isMember(cid, bob));
    }

    function test_inviteOnlyCommunity() public {
        vm.prank(vm.addr(aliceKeyPk));
        uint256 cid = communities.create(alice, CommunityRegistry.JoinType.InviteOnly, address(0), 0, 0, 0, 0, "");
        vm.prank(vm.addr(bobKeyPk));
        vm.expectRevert(CommunityRegistry.NotInvited.selector);
        communities.join(cid, bob);
        vm.prank(vm.addr(aliceKeyPk));
        communities.invite(cid, alice, bob);
        vm.prank(vm.addr(bobKeyPk));
        communities.join(cid, bob);
        assertTrue(communities.isMember(cid, bob));
    }

    function test_paidCommunityExpires() public {
        vm.prank(vm.addr(aliceKeyPk));
        uint256 cid =
            communities.create(alice, CommunityRegistry.JoinType.Paid, address(0), 0, 5e6, 30 days, 0, "ipfs://c");
        address key = vm.addr(bobKeyPk);
        tusd.faucet(key, 5e6);
        vm.startPrank(key);
        tusd.approve(address(payments), 5e6);
        communities.joinPaid(cid, bob, address(tusd));
        vm.stopPrank();
        assertTrue(communities.isMember(cid, bob));
        assertEq(payments.balanceOf(alice, address(tusd)), 5e6);
        vm.warp(block.timestamp + 31 days);
        assertFalse(communities.isMember(cid, bob));
    }

    // ------------------------------------------------------------------ anchor + scouts

    function test_anchorAndVerify() public {
        bytes32 m1 = keccak256("msg1");
        bytes32 m2 = keccak256("msg2");
        bytes32 l1 = keccak256(bytes.concat(keccak256(abi.encode(m1))));
        bytes32 l2 = keccak256(bytes.concat(keccak256(abi.encode(m2))));
        bytes32 root = l1 < l2 ? keccak256(abi.encode(l1, l2)) : keccak256(abi.encode(l2, l1));
        vm.prank(relay);
        uint256 id = anchorC.anchor(root, 2, 1, 2, "https://relay/batches/0");
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = l2;
        assertTrue(anchorC.verify(id, m1, proof));
        assertFalse(anchorC.verify(id, keccak256("forged"), proof));
    }

    function test_escapeHatchRequiresAuth() public {
        vm.prank(vm.addr(aliceKeyPk));
        anchorC.submitMessage(alice, hex"01");
        vm.prank(vm.addr(bobKeyPk));
        vm.expectRevert(FidAuth.Unauthorized.selector);
        anchorC.submitMessage(alice, hex"01");
    }

    function test_scoutRoot() public {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(420)))));
        vm.prank(relay);
        uint256 idx = scouts.post(1, leaf, "ipfs://scores/1");
        assertTrue(scouts.verifyScore(idx, alice, 420, new bytes32[](0)));
        assertFalse(scouts.verifyScore(idx, alice, 421, new bytes32[](0)));
    }
}
