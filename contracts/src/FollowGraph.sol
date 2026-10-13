// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FidAuth} from "./base/FidAuth.sol";
import {Scopes} from "./base/Scopes.sol";

/// @title FollowGraph
/// @notice The shared social graph. Follows are called by an app key on the user's behalf (gas
/// sponsored through the forwarder). The follow timestamp is stored so scouting is provable.
contract FollowGraph is FidAuth {
    error SelfFollow();
    error RateLimited();
    error BatchTooLarge();

    event Followed(uint256 indexed fid, uint256 indexed target, uint64 timestamp);
    event Unfollowed(uint256 indexed fid, uint256 indexed target);
    event DailyLimitSet(uint32 limit);

    uint256 public constant MAX_BATCH = 100;

    /// @notice fid => target => timestamp of follow (0 = not following).
    mapping(uint256 => mapping(uint256 => uint64)) public followedAt;
    mapping(uint256 => uint256) public followerCount;
    mapping(uint256 => uint256) public followingCount;

    uint32 public dailyLimit = 300;
    mapping(uint256 => mapping(uint256 => uint32)) public dailyOps; // fid => day => ops

    constructor(address forwarder, address identity_, address appKeys_, address admin_)
        FidAuth(forwarder, identity_, appKeys_, admin_)
    {}

    function setDailyLimit(uint32 limit) external onlyAdmin {
        dailyLimit = limit;
        emit DailyLimitSet(limit);
    }

    function follow(uint256 fid, uint256 target) external authFid(fid, Scopes.FOLLOW) {
        _consume(fid, 1);
        _follow(fid, target);
    }

    function unfollow(uint256 fid, uint256 target) external authFid(fid, Scopes.FOLLOW) {
        _consume(fid, 1);
        _unfollow(fid, target);
    }

    function followBatch(uint256 fid, uint256[] calldata targets) external authFid(fid, Scopes.FOLLOW) {
        if (targets.length > MAX_BATCH) revert BatchTooLarge();
        _consume(fid, uint32(targets.length));
        for (uint256 i; i < targets.length; ++i) {
            _follow(fid, targets[i]);
        }
    }

    function unfollowBatch(uint256 fid, uint256[] calldata targets) external authFid(fid, Scopes.FOLLOW) {
        if (targets.length > MAX_BATCH) revert BatchTooLarge();
        _consume(fid, uint32(targets.length));
        for (uint256 i; i < targets.length; ++i) {
            _unfollow(fid, targets[i]);
        }
    }

    function isFollowing(uint256 fid, uint256 target) external view returns (bool) {
        return followedAt[fid][target] != 0;
    }

    function _follow(uint256 fid, uint256 target) internal {
        if (fid == target) revert SelfFollow();
        _requireFid(target);
        if (followedAt[fid][target] != 0) return; // idempotent, so optimistic retries are safe
        followedAt[fid][target] = uint64(block.timestamp);
        ++followerCount[target];
        ++followingCount[fid];
        emit Followed(fid, target, uint64(block.timestamp));
    }

    function _unfollow(uint256 fid, uint256 target) internal {
        if (followedAt[fid][target] == 0) return;
        delete followedAt[fid][target];
        --followerCount[target];
        --followingCount[fid];
        emit Unfollowed(fid, target);
    }

    function _consume(uint256 fid, uint32 n) internal {
        uint256 day = _day();
        uint32 used = dailyOps[fid][day] + n;
        if (used > dailyLimit) revert RateLimited();
        dailyOps[fid][day] = used;
    }
}
