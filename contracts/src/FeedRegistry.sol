// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FidAuth} from "./base/FidAuth.sol";
import {Scopes} from "./base/Scopes.sol";

/// @title FeedRegistry
/// @notice Open marketplace of feed algorithms. A feed is either a rule-based JSON definition that
/// clients run locally, or a hosted endpoint returning ranked post IDs. Every definition change is
/// versioned onchain (uri + content hash), so subscribers can see exactly what changed.
contract FeedRegistry is FidAuth {
    error NotFeedOwner();
    error BadDiscovery();
    error BadShare();
    error UnknownFeed();

    enum Kind {
        RuleBased,
        Hosted
    }

    struct Feed {
        uint256 ownerFid;
        Kind kind;
        bool active;
        uint16 discoveryBps; // share of positions reserved for non-followed creators
        uint16 creatorShareBps; // share of subscription revenue paid to surfaced creators
        uint32 version;
        uint64 priceUsd; // per 30 days, 6 decimals (3_000_000 = $3). 0 = free
        bytes32 defHash; // keccak256 of the rule JSON or hosted feed descriptor
        string uri; // where the definition / descriptor lives (ipfs://, https://)
    }

    event FeedCreated(uint256 indexed feedId, uint256 indexed ownerFid, Kind kind, string uri, bytes32 defHash);
    event FeedUpdated(uint256 indexed feedId, uint32 version, string uri, bytes32 defHash);
    event FeedPricingSet(uint256 indexed feedId, uint64 priceUsd, uint16 creatorShareBps);
    event FeedDiscoverySet(uint256 indexed feedId, uint16 discoveryBps);
    event FeedActiveSet(uint256 indexed feedId, bool active);
    event FeedTransferred(uint256 indexed feedId, uint256 indexed toFid);
    event DiscoveryRangeSet(uint16 minBps, uint16 maxBps);

    uint16 public minDiscoveryBps = 500; // 5%
    uint16 public maxDiscoveryBps = 3000; // 30%
    uint16 public constant MAX_BPS = 10_000;

    uint256 public feedCount;
    mapping(uint256 => Feed) internal _feeds;

    constructor(address forwarder, address identity_, address appKeys_, address admin_)
        FidAuth(forwarder, identity_, appKeys_, admin_)
    {}

    function setDiscoveryRange(uint16 minBps, uint16 maxBps) external onlyAdmin {
        if (minBps > maxBps || maxBps > MAX_BPS) revert BadDiscovery();
        minDiscoveryBps = minBps;
        maxDiscoveryBps = maxBps;
        emit DiscoveryRangeSet(minBps, maxBps);
    }

    function create(
        uint256 ownerFid,
        Kind kind,
        string calldata uri,
        bytes32 defHash,
        uint64 priceUsd,
        uint16 creatorShareBps,
        uint16 discoveryBps
    ) external authFid(ownerFid, Scopes.FEED) returns (uint256 feedId) {
        _checkDiscovery(discoveryBps);
        if (creatorShareBps > MAX_BPS) revert BadShare();
        feedId = ++feedCount;
        _feeds[feedId] = Feed(ownerFid, kind, true, discoveryBps, creatorShareBps, 1, priceUsd, defHash, uri);
        emit FeedCreated(feedId, ownerFid, kind, uri, defHash);
        emit FeedUpdated(feedId, 1, uri, defHash);
        emit FeedPricingSet(feedId, priceUsd, creatorShareBps);
        emit FeedDiscoverySet(feedId, discoveryBps);
    }

    function update(uint256 feedId, string calldata uri, bytes32 defHash) external {
        Feed storage f = _owned(feedId);
        uint32 v = ++f.version;
        f.uri = uri;
        f.defHash = defHash;
        emit FeedUpdated(feedId, v, uri, defHash);
    }

    function setPricing(uint256 feedId, uint64 priceUsd, uint16 creatorShareBps) external {
        if (creatorShareBps > MAX_BPS) revert BadShare();
        Feed storage f = _owned(feedId);
        f.priceUsd = priceUsd;
        f.creatorShareBps = creatorShareBps;
        emit FeedPricingSet(feedId, priceUsd, creatorShareBps);
    }

    function setDiscovery(uint256 feedId, uint16 discoveryBps) external {
        _checkDiscovery(discoveryBps);
        _owned(feedId).discoveryBps = discoveryBps;
        emit FeedDiscoverySet(feedId, discoveryBps);
    }

    function setActive(uint256 feedId, bool active) external {
        _owned(feedId).active = active;
        emit FeedActiveSet(feedId, active);
    }

    function transferFeed(uint256 feedId, uint256 toFid) external {
        _requireFid(toFid);
        _owned(feedId).ownerFid = toFid;
        emit FeedTransferred(feedId, toFid);
    }

    // ---------------------------------------------------------------- views

    function getFeed(uint256 feedId) external view returns (Feed memory) {
        return _feeds[feedId];
    }

    function feedOwner(uint256 feedId) external view returns (uint256) {
        return _feeds[feedId].ownerFid;
    }

    function feedPricing(uint256 feedId) external view returns (uint64, uint16, bool) {
        Feed storage f = _feeds[feedId];
        if (f.ownerFid == 0) revert UnknownFeed();
        return (f.priceUsd, f.creatorShareBps, f.active);
    }

    /// @notice Feeds below the protocol discovery range are labeled by clients ("no discovery").
    function meetsDiscoveryStandard(uint256 feedId) external view returns (bool) {
        return _feeds[feedId].discoveryBps >= minDiscoveryBps;
    }

    // ---------------------------------------------------------------- internal

    function _owned(uint256 feedId) internal view returns (Feed storage f) {
        f = _feeds[feedId];
        if (f.ownerFid == 0) revert UnknownFeed();
        _auth(f.ownerFid, Scopes.FEED);
    }

    function _checkDiscovery(uint16 bps) internal view {
        if (bps < minDiscoveryBps || bps > maxDiscoveryBps) revert BadDiscovery();
    }
}
