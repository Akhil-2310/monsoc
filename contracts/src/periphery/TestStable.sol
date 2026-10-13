// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stablecoin with a public faucet. Not for mainnet.
contract TestStable is ERC20 {
    constructor() ERC20("Test USD", "tUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(address to, uint256 amount) external {
        require(amount <= 1_000e6, "max 1000");
        _mint(to, amount);
    }
}
