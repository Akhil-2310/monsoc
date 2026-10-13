// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FidAuth} from "./base/FidAuth.sol";
import {Scopes} from "./base/Scopes.sol";
import {IPayments} from "./interfaces/IProtocol.sol";

/// @title CommunityRegistry
/// @notice Communities with their own members, roles, rules, feed and join type. Membership is
/// onchain so every client and contract agrees on who is in. Moderation of individual posts is
/// done with signed labels offchain; bans live here.
contract CommunityRegistry is FidAuth {
    error UnknownCommunity();
    error NotModerator();
    error NotOwner();
    error AlreadyMember();
    error NotMember();
    error Banned();
    error NotInvited();
    error GateNotMet();
    error WrongJoinType();
    error BadRole();

    enum JoinType {
        Open,
        TokenGated, // ERC20 or ERC721 balanceOf(custody) >= gateMin
        InviteOnly,
        Paid
    }

    uint8 public constant ROLE_NONE = 0;
    uint8 public constant ROLE_MEMBER = 1;
    uint8 public constant ROLE_MODERATOR = 2;
    uint8 public constant ROLE_OWNER = 3;

    struct Community {
        uint256 ownerFid;
        JoinType joinType;
        address gateToken;
        uint256 gateMin;
        uint64 priceUsd; // 6 decimals, per membership period
        uint64 period; // seconds; 0 = lifetime
        uint256 feedId; // default community feed (FeedRegistry id), 0 = none
        uint256 memberCount;
        string uri; // name, description, rules, labelers, chat retention (JSON)
    }

    struct Member {
        uint8 role;
        bool banned;
        uint64 joinedAt;
        uint64 expiresAt; // 0 = no expiry
        uint256 customRoles; // bitmask plugins can interpret ("can post announcements", ...)
    }

    event CommunityCreated(uint256 indexed cid, uint256 indexed ownerFid, JoinType joinType, string uri);
    event CommunityUpdated(uint256 indexed cid, string uri, uint256 feedId);
    event JoinRulesSet(uint256 indexed cid, JoinType joinType, address gateToken, uint256 gateMin, uint64 priceUsd, uint64 period);
    event Joined(uint256 indexed cid, uint256 indexed fid, uint64 expiresAt);
    event Left(uint256 indexed cid, uint256 indexed fid);
    event RoleSet(uint256 indexed cid, uint256 indexed fid, uint8 role);
    event CustomRolesSet(uint256 indexed cid, uint256 indexed fid, uint256 mask);
    event BanSet(uint256 indexed cid, uint256 indexed fid, bool banned);
    event Invited(uint256 indexed cid, uint256 indexed fid, uint256 indexed byFid);

    IPayments public immutable payments;
    uint256 public communityCount;
    mapping(uint256 => Community) internal _communities;
    mapping(uint256 => mapping(uint256 => Member)) public members;
    mapping(uint256 => mapping(uint256 => bool)) public invited;

    constructor(address forwarder, address identity_, address appKeys_, address payments_, address admin_)
        FidAuth(forwarder, identity_, appKeys_, admin_)
    {
        payments = IPayments(payments_);
    }

    // ---------------------------------------------------------------- create / configure

    function create(
        uint256 ownerFid,
        JoinType joinType,
        address gateToken,
        uint256 gateMin,
        uint64 priceUsd,
        uint64 period,
        uint256 feedId,
        string calldata uri
    ) external authFid(ownerFid, Scopes.COMMUNITY) returns (uint256 cid) {
        cid = ++communityCount;
        _communities[cid] = Community(ownerFid, joinType, gateToken, gateMin, priceUsd, period, feedId, 1, uri);
        members[cid][ownerFid] = Member(ROLE_OWNER, false, uint64(block.timestamp), 0, 0);
        emit CommunityCreated(cid, ownerFid, joinType, uri);
        emit JoinRulesSet(cid, joinType, gateToken, gateMin, priceUsd, period);
        emit CommunityUpdated(cid, uri, feedId);
        emit Joined(cid, ownerFid, 0);
        emit RoleSet(cid, ownerFid, ROLE_OWNER);
    }

    function update(uint256 cid, uint256 actorFid, string calldata uri, uint256 feedId) external {
        _requireMod(cid, actorFid);
        Community storage c = _communities[cid];
        c.uri = uri;
        c.feedId = feedId;
        emit CommunityUpdated(cid, uri, feedId);
    }

    function setJoinRules(
        uint256 cid,
        JoinType joinType,
        address gateToken,
        uint256 gateMin,
        uint64 priceUsd,
        uint64 period
    ) external {
        Community storage c = _get(cid);
        _auth(c.ownerFid, Scopes.COMMUNITY);
        c.joinType = joinType;
        c.gateToken = gateToken;
        c.gateMin = gateMin;
        c.priceUsd = priceUsd;
        c.period = period;
        emit JoinRulesSet(cid, joinType, gateToken, gateMin, priceUsd, period);
    }

    // ---------------------------------------------------------------- membership

    function join(uint256 cid, uint256 fid) external authFid(fid, Scopes.COMMUNITY) {
        Community storage c = _get(cid);
        if (c.joinType == JoinType.Paid) revert WrongJoinType();
        if (c.joinType == JoinType.TokenGated) {
            if (!meetsGate(cid, fid)) revert GateNotMet();
        } else if (c.joinType == JoinType.InviteOnly) {
            if (!invited[cid][fid]) revert NotInvited();
            delete invited[cid][fid];
        }
        _admit(cid, fid, 0);
    }

    /// @notice Pay the membership price (in MON or a stablecoin approved to Payments) and join or renew.
    function joinPaid(uint256 cid, uint256 fid, address token) external payable authFid(fid, Scopes.COMMUNITY) {
        Community storage c = _get(cid);
        if (c.joinType != JoinType.Paid) revert WrongJoinType();
        payments.charge{value: msg.value}(_msgSender(), c.ownerFid, c.priceUsd, token, bytes32(cid));
        uint64 expiresAt;
        if (c.period != 0) {
            uint64 base = members[cid][fid].expiresAt;
            if (base < block.timestamp) base = uint64(block.timestamp);
            expiresAt = base + c.period;
        }
        if (isMember(cid, fid)) {
            members[cid][fid].expiresAt = expiresAt;
            emit Joined(cid, fid, expiresAt);
        } else {
            _admit(cid, fid, expiresAt);
        }
    }

    function leave(uint256 cid, uint256 fid) external authFid(fid, Scopes.COMMUNITY) {
        Member storage m = members[cid][fid];
        if (m.role == ROLE_NONE) revert NotMember();
        if (m.role == ROLE_OWNER) revert NotOwner();
        m.role = ROLE_NONE;
        m.customRoles = 0;
        --_communities[cid].memberCount;
        emit Left(cid, fid);
    }

    // ---------------------------------------------------------------- moderation

    function invite(uint256 cid, uint256 actorFid, uint256 fid) external {
        _requireMod(cid, actorFid);
        _requireFid(fid);
        invited[cid][fid] = true;
        emit Invited(cid, fid, actorFid);
    }

    function setBan(uint256 cid, uint256 actorFid, uint256 fid, bool banned) external {
        _requireMod(cid, actorFid);
        Member storage m = members[cid][fid];
        if (m.role >= members[cid][actorFid].role) revert NotModerator(); // can't ban peers or above
        if (banned && m.role != ROLE_NONE) {
            m.role = ROLE_NONE;
            --_communities[cid].memberCount;
            emit Left(cid, fid);
        }
        m.banned = banned;
        emit BanSet(cid, fid, banned);
    }

    function setRole(uint256 cid, uint256 fid, uint8 role) external {
        Community storage c = _get(cid);
        _auth(c.ownerFid, Scopes.COMMUNITY);
        if (role != ROLE_MEMBER && role != ROLE_MODERATOR) revert BadRole();
        if (!isMember(cid, fid) || fid == c.ownerFid) revert NotMember();
        members[cid][fid].role = role;
        emit RoleSet(cid, fid, role);
    }

    function setCustomRoles(uint256 cid, uint256 actorFid, uint256 fid, uint256 mask) external {
        _requireMod(cid, actorFid);
        if (!isMember(cid, fid)) revert NotMember();
        members[cid][fid].customRoles = mask;
        emit CustomRolesSet(cid, fid, mask);
    }

    function transferOwnership(uint256 cid, uint256 toFid) external {
        Community storage c = _get(cid);
        _auth(c.ownerFid, Scopes.COMMUNITY);
        if (!isMember(cid, toFid)) revert NotMember();
        members[cid][c.ownerFid].role = ROLE_MODERATOR;
        emit RoleSet(cid, c.ownerFid, ROLE_MODERATOR);
        c.ownerFid = toFid;
        members[cid][toFid].role = ROLE_OWNER;
        emit RoleSet(cid, toFid, ROLE_OWNER);
    }

    // ---------------------------------------------------------------- views

    function getCommunity(uint256 cid) external view returns (Community memory) {
        return _communities[cid];
    }

    function isMember(uint256 cid, uint256 fid) public view returns (bool) {
        Member storage m = members[cid][fid];
        return m.role != ROLE_NONE && !m.banned && (m.expiresAt == 0 || m.expiresAt >= block.timestamp);
    }

    function meetsGate(uint256 cid, uint256 fid) public view returns (bool) {
        Community storage c = _communities[cid];
        address custody = identity.custodyOf(fid);
        if (custody == address(0) || c.gateToken == address(0)) return false;
        // ERC20 and ERC721 share balanceOf(address)
        return IERC20(c.gateToken).balanceOf(custody) >= c.gateMin;
    }

    // ---------------------------------------------------------------- internal

    function _admit(uint256 cid, uint256 fid, uint64 expiresAt) internal {
        Member storage m = members[cid][fid];
        if (m.banned) revert Banned();
        if (isMember(cid, fid)) revert AlreadyMember();
        if (m.role == ROLE_NONE) ++_communities[cid].memberCount;
        m.role = ROLE_MEMBER;
        m.joinedAt = uint64(block.timestamp);
        m.expiresAt = expiresAt;
        emit Joined(cid, fid, expiresAt);
    }

    function _get(uint256 cid) internal view returns (Community storage c) {
        c = _communities[cid];
        if (c.ownerFid == 0) revert UnknownCommunity();
    }

    function _requireMod(uint256 cid, uint256 actorFid) internal view {
        _get(cid);
        _auth(actorFid, Scopes.COMMUNITY);
        if (!isMember(cid, actorFid) || members[cid][actorFid].role < ROLE_MODERATOR) revert NotModerator();
    }
}
