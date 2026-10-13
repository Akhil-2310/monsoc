// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IProtocol.sol";

/// @notice Testnet MON/USD price feed updated by an operator. Swap for a real oracle or a DEX TWAP
/// before mainnet (open question in the spec).
contract AdminPriceOracle is IPriceOracle {
    error NotUpdater();

    address public updater;
    uint256 public monUsd; // 8 decimals
    uint64 public updatedAt;

    event PriceUpdated(uint256 price);

    constructor(address updater_, uint256 price) {
        updater = updater_;
        monUsd = price;
        updatedAt = uint64(block.timestamp);
    }

    function setPrice(uint256 price) external {
        if (msg.sender != updater) revert NotUpdater();
        monUsd = price;
        updatedAt = uint64(block.timestamp);
        emit PriceUpdated(price);
    }
}
