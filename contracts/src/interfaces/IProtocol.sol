// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIdentityRegistry {
    function custodyOf(uint256 fid) external view returns (address);
    function idOf(address custody) external view returns (uint256);
    function registerFrom(address custody, address recovery, string calldata handle) external returns (uint256 fid);
}

interface IAppKeyRegistry {
    function isAuthorized(uint256 fid, address signer, uint32 scope) external view returns (bool);
    function addFrom(uint256 fid, uint8 keyType, bytes calldata key, uint32 scope, uint64 expiry, uint256 clientFid)
        external;
}

interface IFeedRegistry {
    function feedOwner(uint256 feedId) external view returns (uint256);
    function feedPricing(uint256 feedId) external view returns (uint64 priceUsd, uint16 creatorShareBps, bool active);
}

interface IPayments {
    function charge(address payer, uint256 toFid, uint64 usd, address token, bytes32 ref)
        external
        payable
        returns (uint256 amount);
}

interface IPriceOracle {
    /// @return price of 1 MON in USD with 8 decimals
    function monUsd() external view returns (uint256);
}
