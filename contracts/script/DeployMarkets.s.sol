// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CreatorMarkets} from "../src/CreatorMarkets.sol";

/// Adds CreatorMarkets to an existing deployment (reads and updates deployments/<chainId>.json).
/// DEPLOYER_KEY=0x.. forge script script/DeployMarkets.s.sol --rpc-url <rpc> --broadcast
contract DeployMarkets is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);

        vm.startBroadcast(pk);
        CreatorMarkets markets = new CreatorMarkets(
            vm.parseJsonAddress(json, ".forwarder"),
            vm.parseJsonAddress(json, ".identity"),
            vm.parseJsonAddress(json, ".appKeys"),
            vm.parseJsonAddress(json, ".follows"),
            vm.parseJsonAddress(json, ".tusd"),
            deployer
        );
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(markets)), path, ".markets");
        vm.writeJson(vm.toString(block.number), path, ".marketsStartBlock");
        console2.log("CreatorMarkets", address(markets));
    }
}
