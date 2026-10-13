// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {IIdentityRegistry, IAppKeyRegistry} from "./interfaces/IProtocol.sol";

/// @title Signup
/// @notice One passkey signature creates the fid, sets the handle and authorizes the client's app key.
/// Anyone (normally the relay, paying gas) can submit the signed payload.
contract Signup is EIP712, Nonces {
    error Expired();
    error BadSignature();

    bytes32 public constant SIGNUP_TYPEHASH = keccak256(
        "Signup(address custody,address recovery,string handle,uint8 keyType,bytes key,uint32 scope,uint64 expiry,uint256 clientFid,uint256 nonce,uint256 deadline)"
    );

    IIdentityRegistry public immutable identity;
    IAppKeyRegistry public immutable appKeys;

    struct Params {
        address custody;
        address recovery;
        string handle;
        uint8 keyType;
        bytes key;
        uint32 scope;
        uint64 expiry;
        uint256 clientFid;
        uint256 deadline;
    }

    constructor(address identity_, address appKeys_) EIP712("MonSocSignup", "1") {
        identity = IIdentityRegistry(identity_);
        appKeys = IAppKeyRegistry(appKeys_);
    }

    function signupFor(Params calldata p, bytes calldata sig) external returns (uint256 fid) {
        if (block.timestamp > p.deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SIGNUP_TYPEHASH,
                    p.custody,
                    p.recovery,
                    keccak256(bytes(p.handle)),
                    p.keyType,
                    keccak256(p.key),
                    p.scope,
                    p.expiry,
                    p.clientFid,
                    _useNonce(p.custody),
                    p.deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(p.custody, digest, sig)) revert BadSignature();
        fid = identity.registerFrom(p.custody, p.recovery, p.handle);
        appKeys.addFrom(fid, p.keyType, p.key, p.scope, p.expiry, p.clientFid);
    }
}
