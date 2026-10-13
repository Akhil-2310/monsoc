// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {IIdentityRegistry} from "./interfaces/IProtocol.sol";
import {KeyTypes} from "./base/Scopes.sol";

/// @title AppKeyRegistry
/// @notice The user's custody signs once to authorize a client's key for their fid; the client then
/// signs posts, likes and follows in the background. Keys are scoped, expire, and are revocable.
/// The keyType field keeps the registry open to new signature schemes (and chat encryption keys).
contract AppKeyRegistry is ERC2771Context, EIP712, Nonces {
    error NotCustody();
    error NotTrusted();
    error NotAdmin();
    error Expired();
    error BadSignature();
    error BadKey();
    error KeyExists();
    error UnknownKey();
    error SignerTaken();

    struct Key {
        uint8 keyType;
        uint32 scope;
        uint64 expiry; // 0 = never
        uint64 addedAt;
        bool revoked;
        uint256 clientFid; // client (app) that requested the key, 0 if none
    }

    event KeyAdded(
        uint256 indexed fid,
        bytes32 indexed keyHash,
        uint8 keyType,
        bytes key,
        uint32 scope,
        uint64 expiry,
        uint256 clientFid
    );
    event KeyRevoked(uint256 indexed fid, bytes32 indexed keyHash);

    bytes32 public constant ADD_TYPEHASH = keccak256(
        "AddKey(uint256 fid,uint8 keyType,bytes key,uint32 scope,uint64 expiry,uint256 clientFid,uint256 nonce,uint256 deadline)"
    );

    IIdentityRegistry public immutable identity;
    address public admin;
    mapping(address => bool) public trustedCaller;

    mapping(uint256 => mapping(bytes32 => Key)) internal _keys;
    /// @notice secp256k1 signer address => fid it is bound to (one fid per signer address).
    mapping(address => uint256) public signerFid;

    constructor(address forwarder, address identity_, address admin_)
        ERC2771Context(forwarder)
        EIP712("MonSocAppKeys", "1")
    {
        identity = IIdentityRegistry(identity_);
        admin = admin_;
    }

    function setTrustedCaller(address caller, bool trusted) external {
        if (_msgSender() != admin) revert NotAdmin();
        trustedCaller[caller] = trusted;
    }

    // ---------------------------------------------------------------- add

    function add(uint256 fid, uint8 keyType, bytes calldata key, uint32 scope, uint64 expiry, uint256 clientFid)
        external
    {
        if (identity.custodyOf(fid) != _msgSender()) revert NotCustody();
        _add(fid, keyType, key, scope, expiry, clientFid);
    }

    /// @notice Add a key with the custody's EIP-712 signature (EOA or ERC-1271 passkey account).
    function addFor(
        uint256 fid,
        uint8 keyType,
        bytes calldata key,
        uint32 scope,
        uint64 expiry,
        uint256 clientFid,
        uint256 deadline,
        bytes calldata sig
    ) external {
        if (block.timestamp > deadline) revert Expired();
        address custody = identity.custodyOf(fid);
        if (custody == address(0)) revert NotCustody();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ADD_TYPEHASH, fid, keyType, keccak256(key), scope, expiry, clientFid, _useNonce(custody), deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(custody, digest, sig)) revert BadSignature();
        _add(fid, keyType, key, scope, expiry, clientFid);
    }

    function addFrom(uint256 fid, uint8 keyType, bytes calldata key, uint32 scope, uint64 expiry, uint256 clientFid)
        external
    {
        if (!trustedCaller[msg.sender]) revert NotTrusted();
        _add(fid, keyType, key, scope, expiry, clientFid);
    }

    function _add(uint256 fid, uint8 keyType, bytes calldata key, uint32 scope, uint64 expiry, uint256 clientFid)
        internal
    {
        if (keyType == 0 || key.length == 0) revert BadKey();
        bytes32 keyHash = keccak256(key);
        if (_keys[fid][keyHash].addedAt != 0) revert KeyExists();
        if (keyType == KeyTypes.SECP256K1) {
            if (key.length != 20) revert BadKey();
            address signer = address(bytes20(key));
            if (signerFid[signer] != 0) revert SignerTaken();
            signerFid[signer] = fid;
        }
        _keys[fid][keyHash] = Key(keyType, scope, expiry, uint64(block.timestamp), false, clientFid);
        emit KeyAdded(fid, keyHash, keyType, key, scope, expiry, clientFid);
    }

    // ---------------------------------------------------------------- revoke

    /// @notice Custody revokes any key; a secp256k1 key can also revoke itself.
    function revoke(uint256 fid, bytes calldata key) external {
        bytes32 keyHash = keccak256(key);
        Key storage k = _keys[fid][keyHash];
        if (k.addedAt == 0 || k.revoked) revert UnknownKey();
        address sender = _msgSender();
        bool self = k.keyType == KeyTypes.SECP256K1 && key.length == 20 && address(bytes20(key)) == sender;
        if (!self && identity.custodyOf(fid) != sender) revert NotCustody();
        k.revoked = true;
        if (k.keyType == KeyTypes.SECP256K1) delete signerFid[address(bytes20(key))];
        emit KeyRevoked(fid, keyHash);
    }

    // ---------------------------------------------------------------- views

    function keyOf(uint256 fid, bytes calldata key) external view returns (Key memory) {
        return _keys[fid][keccak256(key)];
    }

    function isActive(uint256 fid, bytes32 keyHash) public view returns (bool) {
        Key storage k = _keys[fid][keyHash];
        return k.addedAt != 0 && !k.revoked && (k.expiry == 0 || k.expiry >= block.timestamp);
    }

    /// @notice True if `signer` is an active secp256k1 key for `fid` whose scope covers `scope`.
    function isAuthorized(uint256 fid, address signer, uint32 scope) external view returns (bool) {
        if (signerFid[signer] != fid || fid == 0) return false;
        bytes32 keyHash = keccak256(abi.encodePacked(signer));
        Key storage k = _keys[fid][keyHash];
        return isActive(fid, keyHash) && (k.scope & scope) == scope;
    }
}
