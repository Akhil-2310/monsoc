// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FidAuth} from "./base/FidAuth.sol";
import {Scopes} from "./base/Scopes.sol";

interface IFollowGraphView {
    function followedAt(uint256 fid, uint256 target) external view returns (uint64);
    function followerCount(uint256 fid) external view returns (uint256);
}

interface IIdentityCounter {
    function idCounter() external view returns (uint256);
}

/// @title CreatorMarkets
/// @notice Milestone markets on creators ("will @x reach 1,000 followers by 31 Dec?"), settled from the
/// onchain follow graph with no outside oracle.
///
/// - Creators opt in; nobody can open a market on a creator without consent, and creators can't stake on
///   their own markets.
/// - Stakes are time-weighted: staking at open earns 2x share weight, falling linearly to 1x at the deadline,
///   so backing a creator before the crowd is worth more.
/// - Winners get their stake back plus a share of the losing pool by weight. A fee on the losing pool goes
///   to the creator and the protocol.
/// - Resolution: anyone submits follower fids; each is verified against FollowGraph and counted once. Only
///   accounts that existed when the market opened count (fids are sequential, so `maxFid` is a snapshot),
///   which stops new sybil accounts from swinging a market. YES settles the moment the count reaches the
///   target; NO settles at the deadline. Counted followers who unfollow can be uncounted by anyone.
contract CreatorMarkets is FidAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotOptedIn();
    error BadTarget();
    error BadDeadline();
    error MarketClosed();
    error MarketOpen();
    error CreatorCannotStake();
    error StakeTooSmall();
    error NothingToClaim();
    error AlreadyClaimed();
    error FeeTooHigh();
    error TooMany();

    enum Outcome {
        Open,
        Yes,
        No,
        Void // one side had no stakes: everyone is refunded
    }

    struct Market {
        uint256 creatorFid;
        uint256 openerFid;
        uint64 target; // follower count to reach
        uint64 openedAt;
        uint64 deadline;
        uint64 resolvedAt;
        uint64 maxFid; // only followers with fid <= maxFid count (accounts that existed at open)
        uint64 counted; // verified, eligible followers counted so far
        Outcome outcome;
        uint128 yesPool;
        uint128 noPool;
        uint128 yesWeight;
        uint128 noWeight;
    }

    struct Position {
        uint128 yesStake;
        uint128 noStake;
        uint128 yesWeight;
        uint128 noWeight;
        address payer; // where winnings go: the address that funded the first stake
        bool claimed;
    }

    event OptInSet(uint256 indexed creatorFid, bool optedIn);
    event MarketCreated(
        uint256 indexed marketId, uint256 indexed creatorFid, uint256 openerFid, uint64 target, uint64 deadline, uint64 maxFid
    );
    event Staked(uint256 indexed marketId, uint256 indexed fid, bool yes, uint256 amount, uint256 weight);
    event FollowerCounted(uint256 indexed marketId, uint256 indexed followerFid, uint64 counted);
    event FollowerUncounted(uint256 indexed marketId, uint256 indexed followerFid, uint64 counted);
    event Resolved(uint256 indexed marketId, Outcome outcome, uint64 counted, uint256 creatorFee, uint256 protocolFee);
    event Claimed(uint256 indexed marketId, uint256 indexed fid, address to, uint256 amount);
    event CreatorFeesWithdrawn(uint256 indexed creatorFid, address to, uint256 amount);

    uint256 public constant WEIGHT_ONE = 1e18;
    uint256 public constant MIN_STAKE = 1e6; // 1 tUSD
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_BATCH = 200;

    IERC20 public immutable token;
    IFollowGraphView public immutable follows;
    address public treasury;
    uint16 public creatorFeeBps = 100; // 1% of the losing pool
    uint16 public protocolFeeBps = 100; // 1% of the losing pool

    uint256 public marketCount;
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => mapping(uint256 => Position)) public positions; // marketId => fid => position
    mapping(uint256 => mapping(uint256 => bool)) public isCounted; // marketId => followerFid
    mapping(uint256 => bool) public optedIn; // creatorFid
    mapping(uint256 => uint256) public creatorFees; // creatorFid => claimable

    constructor(address forwarder, address identity_, address appKeys_, address follows_, address token_, address admin_)
        FidAuth(forwarder, identity_, appKeys_, admin_)
    {
        follows = IFollowGraphView(follows_);
        token = IERC20(token_);
        treasury = admin_;
    }

    function setFees(uint16 creatorBps, uint16 protocolBps, address treasury_) external onlyAdmin {
        if (uint256(creatorBps) + protocolBps > 1000) revert FeeTooHigh();
        creatorFeeBps = creatorBps;
        protocolFeeBps = protocolBps;
        treasury = treasury_;
    }

    // ---------------------------------------------------------------- creators

    /// @notice A creator allows (or stops allowing) new markets about them. Existing markets run to completion.
    function setOptIn(uint256 creatorFid, bool on) external authFid(creatorFid, Scopes.PAY) {
        optedIn[creatorFid] = on;
        emit OptInSet(creatorFid, on);
    }

    function withdrawCreatorFees(uint256 creatorFid) external nonReentrant {
        uint256 amount = creatorFees[creatorFid];
        address to = _requireFid(creatorFid);
        creatorFees[creatorFid] = 0;
        token.safeTransfer(to, amount);
        emit CreatorFeesWithdrawn(creatorFid, to, amount);
    }

    // ---------------------------------------------------------------- markets

    function createMarket(uint256 openerFid, uint256 creatorFid, uint64 target, uint64 deadline)
        external
        authFid(openerFid, Scopes.PAY)
        returns (uint256 marketId)
    {
        _requireFid(creatorFid);
        if (!optedIn[creatorFid]) revert NotOptedIn();
        if (target <= follows.followerCount(creatorFid)) revert BadTarget();
        if (deadline < block.timestamp + MIN_DURATION || deadline > block.timestamp + MAX_DURATION) revert BadDeadline();
        marketId = ++marketCount;
        uint64 maxFid = uint64(IIdentityCounter(address(identity)).idCounter());
        Market storage m = _markets[marketId];
        m.creatorFid = creatorFid;
        m.openerFid = openerFid;
        m.target = target;
        m.openedAt = uint64(block.timestamp);
        m.deadline = deadline;
        m.maxFid = maxFid;
        emit MarketCreated(marketId, creatorFid, openerFid, target, deadline, maxFid);
    }

    /// @notice Stake tUSD on YES (creator hits the target in time) or NO. Earlier stakes carry more weight.
    function stake(uint256 marketId, uint256 fid, bool yes, uint256 amount) external nonReentrant authFid(fid, Scopes.PAY) {
        Market storage m = _markets[marketId];
        if (m.outcome != Outcome.Open || block.timestamp >= m.deadline || m.openedAt == 0) revert MarketClosed();
        if (fid == m.creatorFid) revert CreatorCannotStake();
        if (amount < MIN_STAKE) revert StakeTooSmall();

        address payer = _msgSender();
        token.safeTransferFrom(payer, address(this), amount);
        uint256 w = amount * currentMultiplier(marketId) / WEIGHT_ONE;

        Position storage p = positions[marketId][fid];
        if (p.payer == address(0)) p.payer = payer;
        if (yes) {
            p.yesStake += uint128(amount);
            p.yesWeight += uint128(w);
            m.yesPool += uint128(amount);
            m.yesWeight += uint128(w);
        } else {
            p.noStake += uint128(amount);
            p.noWeight += uint128(w);
            m.noPool += uint128(amount);
            m.noWeight += uint128(w);
        }
        emit Staked(marketId, fid, yes, amount, w);
    }

    /// @notice Count followers toward the target. Anyone may call; every follower is verified onchain.
    /// Ineligible or already-counted fids are skipped, so honest batches never revert.
    function countFollowers(uint256 marketId, uint256[] calldata followerFids) external {
        if (followerFids.length > MAX_BATCH) revert TooMany();
        Market storage m = _markets[marketId];
        if (m.outcome != Outcome.Open || m.openedAt == 0) revert MarketClosed();
        if (block.timestamp >= m.deadline) {
            _resolve(marketId, Outcome.No); // too late: the deadline decides
            return;
        }
        uint256 creator = m.creatorFid;
        uint64 c = m.counted;
        for (uint256 i; i < followerFids.length; ++i) {
            uint256 f = followerFids[i];
            if (f == 0 || f > m.maxFid || f == creator || isCounted[marketId][f]) continue;
            if (follows.followedAt(f, creator) == 0) continue;
            isCounted[marketId][f] = true;
            ++c;
            emit FollowerCounted(marketId, f, c);
        }
        m.counted = c;
        if (c >= m.target) _resolve(marketId, Outcome.Yes);
    }

    /// @notice Remove counted followers who have since unfollowed. Anyone may call.
    function uncountFollowers(uint256 marketId, uint256[] calldata followerFids) external {
        if (followerFids.length > MAX_BATCH) revert TooMany();
        Market storage m = _markets[marketId];
        if (m.outcome != Outcome.Open) revert MarketClosed();
        uint64 c = m.counted;
        for (uint256 i; i < followerFids.length; ++i) {
            uint256 f = followerFids[i];
            if (!isCounted[marketId][f] || follows.followedAt(f, m.creatorFid) != 0) continue;
            isCounted[marketId][f] = false;
            --c;
            emit FollowerUncounted(marketId, f, c);
        }
        m.counted = c;
    }

    /// @notice After the deadline, a market that never reached its target resolves NO. Anyone may call.
    function resolve(uint256 marketId) external {
        Market storage m = _markets[marketId];
        if (m.outcome != Outcome.Open || m.openedAt == 0) revert MarketClosed();
        if (block.timestamp < m.deadline) revert MarketOpen();
        _resolve(marketId, Outcome.No);
    }

    function claim(uint256 marketId, uint256 fid) external nonReentrant {
        Market storage m = _markets[marketId];
        if (m.outcome == Outcome.Open) revert MarketOpen();
        Position storage p = positions[marketId][fid];
        if (p.claimed) revert AlreadyClaimed();
        uint256 amount = payoutOf(marketId, fid);
        if (amount == 0) revert NothingToClaim();
        p.claimed = true;
        token.safeTransfer(p.payer, amount);
        emit Claimed(marketId, fid, p.payer, amount);
    }

    // ---------------------------------------------------------------- views

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _markets[marketId];
    }

    /// @notice Share weight for a stake placed now: 2.0x at open, falling linearly to 1.0x at the deadline (1e18 = 1x).
    function currentMultiplier(uint256 marketId) public view returns (uint256) {
        Market storage m = _markets[marketId];
        if (block.timestamp >= m.deadline) return WEIGHT_ONE;
        uint256 left = m.deadline - block.timestamp;
        uint256 total = m.deadline - m.openedAt;
        return WEIGHT_ONE + WEIGHT_ONE * left / total;
    }

    /// @notice What `fid` can claim once the market is resolved (0 while open or after claiming).
    function payoutOf(uint256 marketId, uint256 fid) public view returns (uint256) {
        Market storage m = _markets[marketId];
        Position storage p = positions[marketId][fid];
        if (m.outcome == Outcome.Open || p.claimed) return 0;
        if (m.outcome == Outcome.Void) return uint256(p.yesStake) + p.noStake;
        bool yesWon = m.outcome == Outcome.Yes;
        uint256 stakeBack = yesWon ? p.yesStake : p.noStake;
        uint256 myWeight = yesWon ? p.yesWeight : p.noWeight;
        uint256 sideWeight = yesWon ? m.yesWeight : m.noWeight;
        if (myWeight == 0) return 0;
        uint256 losing = yesWon ? m.noPool : m.yesPool;
        uint256 distributable = losing - losing * (uint256(creatorFeeBps) + protocolFeeBps) / 10_000;
        return stakeBack + distributable * myWeight / sideWeight;
    }

    // ---------------------------------------------------------------- internal

    function _resolve(uint256 marketId, Outcome outcome) internal {
        Market storage m = _markets[marketId];
        // no counterparty on one side: nothing to win, refund everyone
        if (m.yesPool == 0 || m.noPool == 0) outcome = Outcome.Void;
        m.outcome = outcome;
        m.resolvedAt = uint64(block.timestamp);
        uint256 cFee;
        uint256 pFee;
        if (outcome != Outcome.Void) {
            uint256 losing = outcome == Outcome.Yes ? m.noPool : m.yesPool;
            cFee = losing * creatorFeeBps / 10_000;
            pFee = losing * protocolFeeBps / 10_000;
            creatorFees[m.creatorFid] += cFee;
            if (pFee != 0) token.safeTransfer(treasury, pFee);
        }
        emit Resolved(marketId, outcome, m.counted, cFee, pFee);
    }
}
