// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {AppKeyRegistry} from "../src/AppKeyRegistry.sol";
import {FollowGraph} from "../src/FollowGraph.sol";
import {CreatorMarkets} from "../src/CreatorMarkets.sol";
import {TestStable} from "../src/periphery/TestStable.sol";
import {FidAuth} from "../src/base/FidAuth.sol";

contract CreatorMarketsTest is Test {
    ERC2771Forwarder fwd;
    IdentityRegistry identity;
    AppKeyRegistry appKeys;
    FollowGraph follows;
    CreatorMarkets markets;
    TestStable tusd;
    address admin = makeAddr("admin");

    // fid => custody address (custody can act for its fid directly)
    mapping(uint256 => address) who;
    uint256 creator;
    uint256 alice; // early YES
    uint256 bob; // late YES
    uint256 carol; // NO

    function setUp() public {
        fwd = new ERC2771Forwarder("MonSocForwarder");
        identity = new IdentityRegistry(address(fwd), admin);
        appKeys = new AppKeyRegistry(address(fwd), address(identity), admin);
        follows = new FollowGraph(address(fwd), address(identity), address(appKeys), admin);
        tusd = new TestStable(address(fwd));
        markets = new CreatorMarkets(address(fwd), address(identity), address(appKeys), address(follows), address(tusd), admin);

        creator = _user("creator");
        alice = _user("alice");
        bob = _user("bob");
        carol = _user("carol");
        vm.prank(who[creator]);
        markets.setOptIn(creator, true);
    }

    function _user(string memory name) internal returns (uint256 fid) {
        address a = makeAddr(name);
        vm.prank(a);
        fid = identity.register(address(0), "");
        who[fid] = a;
        tusd.faucet(a, 1_000e6);
        vm.prank(a);
        tusd.approve(address(markets), type(uint256).max);
    }

    function _follow(uint256 fid, uint256 target) internal {
        vm.prank(who[fid]);
        follows.follow(fid, target);
    }

    function _open(uint64 target, uint64 duration) internal returns (uint256) {
        vm.prank(who[alice]);
        return markets.createMarket(alice, creator, target, uint64(block.timestamp) + duration);
    }

    function _stake(uint256 id, uint256 fid, bool yes, uint256 amount) internal {
        vm.prank(who[fid]);
        markets.stake(id, fid, yes, amount);
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    // ------------------------------------------------------------------ consent + creation

    function test_requiresCreatorOptIn() public {
        vm.prank(who[creator]);
        markets.setOptIn(creator, false);
        vm.prank(who[alice]);
        vm.expectRevert(CreatorMarkets.NotOptedIn.selector);
        markets.createMarket(alice, creator, 5, uint64(block.timestamp + 1 days));
    }

    function test_targetMustBeAboveCurrentFollowers() public {
        _follow(alice, creator);
        vm.prank(who[alice]);
        vm.expectRevert(CreatorMarkets.BadTarget.selector);
        markets.createMarket(alice, creator, 1, uint64(block.timestamp + 1 days));
    }

    function test_creatorCannotStakeOnOwnMarket() public {
        uint256 id = _open(2, 1 days);
        vm.prank(who[creator]);
        vm.expectRevert(CreatorMarkets.CreatorCannotStake.selector);
        markets.stake(id, creator, false, 10e6);
    }

    function test_cannotStakeForSomeoneElse() public {
        uint256 id = _open(2, 1 days);
        vm.prank(who[bob]);
        vm.expectRevert(FidAuth.Unauthorized.selector);
        markets.stake(id, alice, true, 10e6);
    }

    // ------------------------------------------------------------------ weights

    function test_earlyStakesWeighMore() public {
        uint256 t0 = block.timestamp; // absolute warps: via-IR can cache block.timestamp across warps in tests
        uint256 id = _open(2, 10 days);
        assertEq(markets.currentMultiplier(id), 2e18);
        vm.warp(t0 + 5 days);
        assertEq(markets.currentMultiplier(id), 1.5e18);
        vm.warp(t0 + 10 days);
        assertEq(markets.currentMultiplier(id), 1e18);
    }

    // ------------------------------------------------------------------ YES path: oracle-free settlement

    function test_yesSettlesFromFollowGraphAndPaysEarlyBackersMore() public {
        uint256 id = _open(2, 10 days);
        _stake(id, alice, true, 100e6); // at open: weight 200
        vm.warp(block.timestamp + 5 days);
        _stake(id, bob, true, 100e6); // halfway: weight 150
        _stake(id, carol, false, 100e6);

        _follow(alice, creator);
        _follow(bob, creator);
        // anyone (here: a random keeper) submits followers; contract verifies each follow onchain
        vm.prank(makeAddr("keeper"));
        markets.countFollowers(id, _ids(alice, bob));

        CreatorMarkets.Market memory m = markets.getMarket(id);
        assertEq(uint8(m.outcome), uint8(CreatorMarkets.Outcome.Yes));
        assertEq(m.counted, 2);

        // losing pool 100, 2% fee -> 98 distributed 200:150 between alice and bob
        assertEq(markets.payoutOf(id, alice), 100e6 + 56e6);
        assertEq(markets.payoutOf(id, bob), 100e6 + 42e6);
        assertEq(markets.payoutOf(id, carol), 0);
        assertEq(markets.creatorFees(creator), 1e6);
        assertEq(tusd.balanceOf(admin), 1e6);

        uint256 before = tusd.balanceOf(who[alice]);
        markets.claim(id, alice);
        assertEq(tusd.balanceOf(who[alice]) - before, 156e6);
        vm.expectRevert(CreatorMarkets.AlreadyClaimed.selector);
        markets.claim(id, alice);
        markets.claim(id, bob);
        vm.expectRevert(CreatorMarkets.NothingToClaim.selector);
        markets.claim(id, carol);

        markets.withdrawCreatorFees(creator);
        assertEq(tusd.balanceOf(who[creator]), 1_000e6 + 1e6);
        assertEq(tusd.balanceOf(address(markets)), 0); // fully settled, nothing stuck
    }

    function test_marketClosesAfterResolution() public {
        uint256 id = _open(1, 1 days);
        _stake(id, alice, true, 10e6);
        _stake(id, carol, false, 10e6);
        _follow(bob, creator);
        markets.countFollowers(id, _ids(bob, 0));
        vm.prank(who[bob]);
        vm.expectRevert(CreatorMarkets.MarketClosed.selector);
        markets.stake(id, bob, true, 10e6);
    }

    // ------------------------------------------------------------------ anti-manipulation

    function test_accountsCreatedAfterOpenDontCount() public {
        uint256 id = _open(2, 1 days);
        _stake(id, alice, true, 10e6);
        _stake(id, carol, false, 10e6);
        uint256 sybil1 = _user("sybil1");
        uint256 sybil2 = _user("sybil2");
        _follow(sybil1, creator);
        _follow(sybil2, creator);
        markets.countFollowers(id, _ids(sybil1, sybil2));
        CreatorMarkets.Market memory m = markets.getMarket(id);
        assertEq(m.counted, 0);
        assertEq(uint8(m.outcome), uint8(CreatorMarkets.Outcome.Open));
    }

    function test_nonFollowersAndDuplicatesAreSkipped() public {
        uint256 id = _open(3, 1 days);
        _follow(alice, creator);
        markets.countFollowers(id, _ids(alice, alice));
        markets.countFollowers(id, _ids(alice, bob)); // bob doesn't follow
        assertEq(markets.getMarket(id).counted, 1);
    }

    function test_unfollowersCanBeUncounted() public {
        uint256 id = _open(3, 1 days);
        _follow(alice, creator);
        _follow(bob, creator);
        markets.countFollowers(id, _ids(alice, bob));
        vm.prank(who[bob]);
        follows.unfollow(bob, creator);
        markets.uncountFollowers(id, _ids(alice, bob)); // alice still follows: skipped
        assertEq(markets.getMarket(id).counted, 1);
        assertFalse(markets.isCounted(id, bob));
    }

    // ------------------------------------------------------------------ NO + void paths

    function test_noAtDeadline() public {
        uint256 id = _open(5, 1 days);
        _stake(id, alice, true, 50e6);
        _stake(id, carol, false, 25e6);
        vm.expectRevert(CreatorMarkets.MarketOpen.selector);
        markets.resolve(id);
        vm.warp(block.timestamp + 1 days);
        markets.resolve(id);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(CreatorMarkets.Outcome.No));
        assertEq(markets.payoutOf(id, carol), 25e6 + 49e6); // all of the losing 50 minus 2%
        assertEq(markets.payoutOf(id, alice), 0);
    }

    function test_oneSidedMarketRefunds() public {
        uint256 id = _open(5, 1 days);
        _stake(id, alice, true, 40e6);
        vm.warp(block.timestamp + 1 days);
        markets.resolve(id);
        assertEq(uint8(markets.getMarket(id).outcome), uint8(CreatorMarkets.Outcome.Void));
        assertEq(markets.payoutOf(id, alice), 40e6);
        markets.claim(id, alice);
        assertEq(tusd.balanceOf(who[alice]), 1_000e6);
    }

    function test_lateCountAfterDeadlineResolvesNo() public {
        uint256 id = _open(1, 1 days);
        _stake(id, alice, true, 10e6);
        _stake(id, carol, false, 10e6);
        _follow(bob, creator);
        vm.warp(block.timestamp + 1 days);
        markets.countFollowers(id, _ids(bob, 0)); // follow came too late to be counted in time
        assertEq(uint8(markets.getMarket(id).outcome), uint8(CreatorMarkets.Outcome.No));
    }

    /// Payouts plus fees never exceed what was staked, for any split.
    function testFuzz_solvent(uint96 a, uint96 b, uint96 c, uint32 lateBy) public {
        a = uint96(bound(a, 1e6, 300e6));
        b = uint96(bound(b, 1e6, 300e6));
        c = uint96(bound(c, 1e6, 300e6));
        uint256 id = _open(1, 10 days);
        _stake(id, alice, true, a);
        vm.warp(block.timestamp + bound(lateBy, 0, 10 days - 1));
        _stake(id, bob, true, b);
        _stake(id, carol, false, c);
        _follow(alice, creator);
        markets.countFollowers(id, _ids(alice, 0));
        markets.claim(id, alice);
        markets.claim(id, bob);
        markets.withdrawCreatorFees(creator);
        assertLe(0, tusd.balanceOf(address(markets))); // dust only
        assertLt(tusd.balanceOf(address(markets)), 3);
    }
}
