// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {FidAuth} from "./base/FidAuth.sol";
import {IFeedRegistry, IPriceOracle} from "./interfaces/IProtocol.sol";

/// @title Payments
/// @notice Everything is priced in dollars (6 decimals) and paid in MON or an accepted stablecoin.
/// Feed subscriptions are split between protocol fee (default 0), the feed owner and a creator
/// pool. The creator pool is distributed per epoch by an offchain job that totals subscriber-signed
/// engagement and posts one Merkle root; each creator claims with a proof, so gas stays flat.
contract Payments is FidAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error TokenNotAccepted();
    error InsufficientValue();
    error NotModule();
    error NotDistributor();
    error FeedInactive();
    error FeedIsFree();
    error EpochNotOver();
    error RootExists();
    error ExceedsPool();
    error AlreadyClaimed();
    error BadProof();
    error FeeTooHigh();
    error TransferFailed();
    error ZeroPeriods();

    address public constant NATIVE = address(0);
    uint64 public constant PERIOD = 30 days;
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 500;

    IFeedRegistry public immutable feeds;
    uint64 public immutable genesis;
    uint64 public immutable epochLength;

    IPriceOracle public oracle;
    address public treasury;
    uint16 public protocolFeeBps;
    mapping(address => bool) public acceptedToken; // ERC20 stablecoins
    mapping(address => bool) public isModule; // e.g. CommunityRegistry, plugin routers
    mapping(address => bool) public isDistributor; // payout job

    /// @notice claimable balances per fid per token (feed owners, tips, memberships)
    mapping(uint256 => mapping(address => uint256)) public balanceOf;
    /// @notice subscriber fid => feed => paid until
    mapping(uint256 => mapping(uint256 => uint64)) public subscribedUntil;
    /// @notice epoch => token => creator pool accumulated
    mapping(uint256 => mapping(address => uint256)) public creatorPool;
    /// @notice epoch => token => payout root
    mapping(uint256 => mapping(address => bytes32)) public payoutRoot;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public claimed;

    event TokenAccepted(address token, bool accepted);
    event OracleSet(address oracle);
    event ProtocolFeeSet(uint16 bps, address treasury);
    event Subscribed(
        uint256 indexed subscriberFid,
        uint256 indexed feedId,
        address token,
        uint256 amount,
        uint256 toCreators,
        uint64 until,
        uint256 epoch
    );
    event Paid(
        address indexed payer, uint256 indexed toFid, address token, uint256 amount, uint64 usd, bytes32 indexed ref
    );
    event Tipped(address indexed from, uint256 indexed toFid, address token, uint256 amount);
    event Withdrawn(uint256 indexed fid, address token, uint256 amount, address to);
    event PayoutRootPosted(uint256 indexed epoch, address token, bytes32 root, uint256 total, string uri);
    event PayoutClaimed(uint256 indexed epoch, address token, uint256 indexed fid, uint256 amount);

    constructor(
        address forwarder,
        address identity_,
        address appKeys_,
        address feeds_,
        address admin_,
        uint64 epochLength_
    ) FidAuth(forwarder, identity_, appKeys_, admin_) {
        feeds = IFeedRegistry(feeds_);
        genesis = uint64(block.timestamp);
        epochLength = epochLength_;
        treasury = admin_;
    }

    // ---------------------------------------------------------------- admin

    function setAcceptedToken(address token, bool accepted) external onlyAdmin {
        acceptedToken[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    function setOracle(address oracle_) external onlyAdmin {
        oracle = IPriceOracle(oracle_);
        emit OracleSet(oracle_);
    }

    function setProtocolFee(uint16 bps, address treasury_) external onlyAdmin {
        if (bps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        protocolFeeBps = bps;
        treasury = treasury_;
        emit ProtocolFeeSet(bps, treasury_);
    }

    function setModule(address module, bool enabled) external onlyAdmin {
        isModule[module] = enabled;
    }

    function setDistributor(address d, bool enabled) external onlyAdmin {
        isDistributor[d] = enabled;
    }

    // ---------------------------------------------------------------- pricing

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesis) / epochLength;
    }

    /// @notice Token amount for a dollar price (6 decimals).
    function quote(uint64 usd, address token) public view returns (uint256) {
        if (token == NATIVE) {
            if (address(oracle) == address(0)) revert TokenNotAccepted();
            // usd(6d) * 1e18 * 1e8 / (price(8d) * 1e6), rounded up
            uint256 num = uint256(usd) * 1e20;
            uint256 den = oracle.monUsd();
            return (num + den - 1) / den;
        }
        if (!acceptedToken[token]) revert TokenNotAccepted();
        uint8 dec = IERC20Metadata(token).decimals();
        if (dec >= 6) return uint256(usd) * 10 ** (dec - 6);
        return (uint256(usd) + 10 ** (6 - dec) - 1) / 10 ** (6 - dec);
    }

    // ---------------------------------------------------------------- subscriptions

    /// @notice Pay for `periods` x 30 days of a paid feed for `subscriberFid` (anyone can gift).
    function subscribe(uint256 subscriberFid, uint256 feedId, address token, uint8 periods)
        external
        payable
        nonReentrant
    {
        if (periods == 0) revert ZeroPeriods();
        _requireFid(subscriberFid);
        (uint64 priceUsd, uint16 creatorShareBps, bool active) = feeds.feedPricing(feedId);
        if (!active) revert FeedInactive();
        if (priceUsd == 0) revert FeedIsFree();

        uint256 amount = quote(priceUsd, token) * periods;
        _collect(_msgSender(), token, amount);

        uint256 fee = amount * protocolFeeBps / 10_000;
        uint256 rest = amount - fee;
        uint256 toCreators = rest * creatorShareBps / 10_000;
        uint256 epoch = currentEpoch();
        if (fee != 0) _send(token, treasury, fee);
        creatorPool[epoch][token] += toCreators;
        balanceOf[feeds.feedOwner(feedId)][token] += rest - toCreators;

        uint64 start = subscribedUntil[subscriberFid][feedId];
        if (start < block.timestamp) start = uint64(block.timestamp);
        uint64 until = start + PERIOD * periods;
        subscribedUntil[subscriberFid][feedId] = until;
        emit Subscribed(subscriberFid, feedId, token, amount, toCreators, until, epoch);
    }

    function isSubscribed(uint256 fid, uint256 feedId) external view returns (bool) {
        return subscribedUntil[fid][feedId] >= block.timestamp;
    }

    // ---------------------------------------------------------------- generic payments

    function tip(uint256 toFid, address token, uint256 amount) external payable nonReentrant {
        _requireFid(toFid);
        if (token != NATIVE && !acceptedToken[token]) revert TokenNotAccepted();
        _collect(_msgSender(), token, amount);
        balanceOf[toFid][token] += amount;
        emit Tipped(_msgSender(), toFid, token, amount);
    }

    /// @notice Pay a dollar amount to a fid, e.g. plugin or client fees. `ref` tags the purpose.
    function pay(uint256 toFid, uint64 usd, address token, bytes32 ref) external payable nonReentrant returns (uint256) {
        return _pay(_msgSender(), toFid, usd, token, ref);
    }

    /// @notice Modules (CommunityRegistry, plugins) charge a payer who approved this contract.
    function charge(address payer, uint256 toFid, uint64 usd, address token, bytes32 ref)
        external
        payable
        nonReentrant
        returns (uint256)
    {
        if (!isModule[msg.sender]) revert NotModule();
        return _pay(payer, toFid, usd, token, ref);
    }

    function _pay(address payer, uint256 toFid, uint64 usd, address token, bytes32 ref) internal returns (uint256 amount) {
        _requireFid(toFid);
        amount = quote(usd, token);
        _collect(payer, token, amount);
        uint256 fee = amount * protocolFeeBps / 10_000;
        if (fee != 0) _send(token, treasury, fee);
        balanceOf[toFid][token] += amount - fee;
        emit Paid(payer, toFid, token, amount, usd, ref);
    }

    /// @notice Withdraw a fid's balance. Always paid to the fid's custody, so anyone may trigger it.
    function withdraw(uint256 fid, address token) external nonReentrant {
        address to = _requireFid(fid);
        uint256 amount = balanceOf[fid][token];
        balanceOf[fid][token] = 0;
        _send(token, to, amount);
        emit Withdrawn(fid, token, amount, to);
    }

    // ---------------------------------------------------------------- creator payouts

    /// @notice Post the payout root for a finished epoch. Leaves: keccak(keccak(abi.encode(epoch, token, fid, amount))).
    /// Unallocated pool rolls into the current epoch.
    function postPayoutRoot(uint256 epoch, address token, bytes32 root, uint256 total, string calldata uri) external {
        if (!isDistributor[_msgSender()]) revert NotDistributor();
        uint256 cur = currentEpoch();
        if (epoch >= cur) revert EpochNotOver();
        if (payoutRoot[epoch][token] != bytes32(0)) revert RootExists();
        uint256 pool = creatorPool[epoch][token];
        if (total > pool) revert ExceedsPool();
        payoutRoot[epoch][token] = root;
        creatorPool[epoch][token] = total;
        creatorPool[cur][token] += pool - total;
        emit PayoutRootPosted(epoch, token, root, total, uri);
    }

    function claim(uint256 epoch, address token, uint256 fid, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        if (claimed[epoch][token][fid]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, token, fid, amount))));
        if (!MerkleProof.verifyCalldata(proof, payoutRoot[epoch][token], leaf)) revert BadProof();
        claimed[epoch][token][fid] = true;
        address to = _requireFid(fid);
        _send(token, to, amount);
        emit PayoutClaimed(epoch, token, fid, amount);
    }

    // ---------------------------------------------------------------- internal

    function _collect(address payer, address token, uint256 amount) internal {
        if (token == NATIVE) {
            if (msg.value < amount) revert InsufficientValue();
            uint256 refund = msg.value - amount;
            if (refund != 0) _send(NATIVE, payer, refund);
        } else {
            if (msg.value != 0) revert InsufficientValue();
            IERC20(token).safeTransferFrom(payer, address(this), amount);
        }
    }

    function _send(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
