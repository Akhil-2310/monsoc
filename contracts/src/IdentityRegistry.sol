// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title IdentityRegistry
/// @notice Issues each user a numeric ID (fid) owned by a custody address (typically a passkey
/// smart account). A recovery address can move the ID if the passkey device is lost.
/// Handles (e.g. "arjun") are optional, unique and move with the ID.
contract IdentityRegistry is ERC2771Context, EIP712, Nonces {
    error AlreadyRegistered();
    error NotCustody();
    error NotRecovery();
    error NotAdmin();
    error NotTrusted();
    error Expired();
    error BadSignature();
    error HandleTaken();
    error InvalidHandle();
    error UnknownFid();

    event Registered(uint256 indexed fid, address indexed custody, address recovery);
    event Transferred(uint256 indexed fid, address indexed from, address indexed to);
    event RecoverySet(uint256 indexed fid, address recovery);
    event HandleSet(uint256 indexed fid, string handle);

    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(uint256 fid,address to,uint256 nonce,uint256 deadline)");

    uint256 public idCounter;
    address public admin;
    mapping(address => bool) public trustedCaller; // Signup bundler

    mapping(address => uint256) public idOf;
    mapping(uint256 => address) public custodyOf;
    mapping(uint256 => address) public recoveryOf;
    mapping(uint256 => string) public handleOf;
    mapping(bytes32 => uint256) public fidOfHandle;

    constructor(address forwarder, address admin_) ERC2771Context(forwarder) EIP712("MonSocIdentity", "1") {
        admin = admin_;
    }

    // ---------------------------------------------------------------- admin

    function setTrustedCaller(address caller, bool trusted) external {
        if (_msgSender() != admin) revert NotAdmin();
        trustedCaller[caller] = trusted;
    }

    function setAdmin(address admin_) external {
        if (_msgSender() != admin) revert NotAdmin();
        admin = admin_;
    }

    // ---------------------------------------------------------------- registration

    /// @notice Register the caller (or meta-tx signer) as custody of a new fid.
    function register(address recovery, string calldata handle) external returns (uint256) {
        return _register(_msgSender(), recovery, handle);
    }

    /// @notice Called by the Signup bundler after it verified the custody's signature.
    function registerFrom(address custody, address recovery, string calldata handle) external returns (uint256) {
        if (!trustedCaller[msg.sender]) revert NotTrusted();
        return _register(custody, recovery, handle);
    }

    function _register(address custody, address recovery, string calldata handle) internal returns (uint256 fid) {
        if (idOf[custody] != 0) revert AlreadyRegistered();
        fid = ++idCounter;
        idOf[custody] = fid;
        custodyOf[fid] = custody;
        recoveryOf[fid] = recovery;
        emit Registered(fid, custody, recovery);
        if (bytes(handle).length != 0) _setHandle(fid, handle);
    }

    // ---------------------------------------------------------------- custody

    function transfer(address to) external {
        uint256 fid = idOf[_msgSender()];
        if (fid == 0) revert NotCustody();
        _transfer(fid, to);
    }

    /// @notice Gasless transfer signed by the current custody (EOA or ERC-1271 smart account).
    function transferFor(uint256 fid, address to, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert Expired();
        address custody = custodyOf[fid];
        if (custody == address(0)) revert UnknownFid();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(TRANSFER_TYPEHASH, fid, to, _useNonce(custody), deadline)));
        if (!SignatureChecker.isValidSignatureNow(custody, digest, sig)) revert BadSignature();
        _transfer(fid, to);
    }

    /// @notice Recovery address moves the fid to a new custody (e.g. a new passkey account).
    function recover(uint256 fid, address to) external {
        if (recoveryOf[fid] == address(0) || _msgSender() != recoveryOf[fid]) revert NotRecovery();
        _transfer(fid, to);
    }

    function setRecovery(address recovery) external {
        uint256 fid = idOf[_msgSender()];
        if (fid == 0) revert NotCustody();
        recoveryOf[fid] = recovery;
        emit RecoverySet(fid, recovery);
    }

    function _transfer(uint256 fid, address to) internal {
        if (idOf[to] != 0) revert AlreadyRegistered();
        address from = custodyOf[fid];
        delete idOf[from];
        idOf[to] = fid;
        custodyOf[fid] = to;
        emit Transferred(fid, from, to);
    }

    // ---------------------------------------------------------------- handles

    function setHandle(string calldata handle) external {
        uint256 fid = idOf[_msgSender()];
        if (fid == 0) revert NotCustody();
        _setHandle(fid, handle);
    }

    function _setHandle(uint256 fid, string calldata handle) internal {
        bytes32 key;
        if (bytes(handle).length != 0) {
            if (!isValidHandle(handle)) revert InvalidHandle();
            key = keccak256(bytes(handle));
            if (fidOfHandle[key] != 0) revert HandleTaken();
        }
        string memory old = handleOf[fid];
        if (bytes(old).length != 0) delete fidOfHandle[keccak256(bytes(old))];
        if (key != bytes32(0)) fidOfHandle[key] = fid;
        handleOf[fid] = handle;
        emit HandleSet(fid, handle);
    }

    /// @notice 1-16 chars of [a-z0-9_].
    function isValidHandle(string calldata handle) public pure returns (bool) {
        bytes calldata b = bytes(handle);
        if (b.length == 0 || b.length > 16) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f)) return false;
        }
        return true;
    }

    function fidByHandle(string calldata handle) external view returns (uint256) {
        return fidOfHandle[keccak256(bytes(handle))];
    }
}
