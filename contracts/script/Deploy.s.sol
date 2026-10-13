// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
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

/// DEPLOYER_KEY=0x.. forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast
/// Env: DEPLOYER_KEY (required), RELAY_ADDRESS (defaults to deployer), EPOCH_SECONDS (default 1 day), MON_USD_8D (default $1)
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);
        address relay = vm.envOr("RELAY_ADDRESS", deployer);
        uint64 epoch = uint64(vm.envOr("EPOCH_SECONDS", uint256(1 days)));
        uint256 monUsd = vm.envOr("MON_USD_8D", uint256(1e8));

        vm.startBroadcast(pk);
        ERC2771Forwarder forwarder = new ERC2771Forwarder("MonSocForwarder");
        address fwd = address(forwarder);
        IdentityRegistry identity = new IdentityRegistry(fwd, deployer);
        AppKeyRegistry appKeys = new AppKeyRegistry(fwd, address(identity), deployer);
        Signup signup = new Signup(address(identity), address(appKeys));
        FollowGraph follows = new FollowGraph(fwd, address(identity), address(appKeys), deployer);
        FeedRegistry feeds = new FeedRegistry(fwd, address(identity), address(appKeys), deployer);
        Payments payments = new Payments(fwd, address(identity), address(appKeys), address(feeds), deployer, epoch);
        Anchor anchor = new Anchor(fwd, address(identity), address(appKeys), deployer);
        CommunityRegistry communities =
            new CommunityRegistry(fwd, address(identity), address(appKeys), address(payments), deployer);
        ScoutRegistry scouts = new ScoutRegistry(deployer);
        AdminPriceOracle oracle = new AdminPriceOracle(relay, monUsd);
        TestStable tusd = new TestStable();

        identity.setTrustedCaller(address(signup), true);
        appKeys.setTrustedCaller(address(signup), true);
        payments.setModule(address(communities), true);
        payments.setAcceptedToken(address(tusd), true);
        payments.setOracle(address(oracle));
        payments.setDistributor(relay, true);
        scouts.setPublisher(relay, true);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", block.number);
        vm.serializeAddress(o, "forwarder", fwd);
        vm.serializeAddress(o, "identity", address(identity));
        vm.serializeAddress(o, "appKeys", address(appKeys));
        vm.serializeAddress(o, "signup", address(signup));
        vm.serializeAddress(o, "follows", address(follows));
        vm.serializeAddress(o, "feeds", address(feeds));
        vm.serializeAddress(o, "payments", address(payments));
        vm.serializeAddress(o, "anchor", address(anchor));
        vm.serializeAddress(o, "communities", address(communities));
        vm.serializeAddress(o, "scouts", address(scouts));
        vm.serializeAddress(o, "oracle", address(oracle));
        string memory json = vm.serializeAddress(o, "tusd", address(tusd));
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
