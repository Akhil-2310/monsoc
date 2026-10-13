// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {FidAuth} from "./base/FidAuth.sol";
import {Scopes} from "./base/Scopes.sol";

/// @title Anchor
/// @notice Relays post a Merkle root of new content every few minutes, plus a link to the batch
/// data, so anyone can prove a message existed unaltered and detect relays that drop data.
/// Escape hatch: users can publish a signed message here directly; honest relays must ingest it.
contract Anchor is FidAuth {
    error NotRelay();

    struct Batch {
        bytes32 root;
        address relay;
        uint64 timestamp;
        uint64 count;
        uint64 fromSeq; // relay-local sequence range, for gap detection
        uint64 toSeq;
    }

    event RelaySet(address indexed relay, bool allowed);
    event Anchored(
        uint256 indexed batchId,
        address indexed relay,
        bytes32 root,
        uint64 count,
        uint64 fromSeq,
        uint64 toSeq,
        string dataUri
    );
    event EscapeHatch(uint256 indexed fid, bytes32 indexed messageHash, bytes message);

    /// @notice While false, anyone may anchor. Admin can restrict to an allowlist in early phases.
    bool public permissioned;
    mapping(address => bool) public isRelay;
    Batch[] internal _batches;

    constructor(address forwarder, address identity_, address appKeys_, address admin_)
        FidAuth(forwarder, identity_, appKeys_, admin_)
    {}

    function setPermissioned(bool p) external onlyAdmin {
        permissioned = p;
    }

    function setRelay(address relay, bool allowed) external onlyAdmin {
        isRelay[relay] = allowed;
        emit RelaySet(relay, allowed);
    }

    function anchor(bytes32 root, uint64 count, uint64 fromSeq, uint64 toSeq, string calldata dataUri)
        external
        returns (uint256 batchId)
    {
        address relay = _msgSender();
        if (permissioned && !isRelay[relay]) revert NotRelay();
        batchId = _batches.length;
        _batches.push(Batch(root, relay, uint64(block.timestamp), count, fromSeq, toSeq));
        emit Anchored(batchId, relay, root, count, fromSeq, toSeq, dataUri);
    }

    /// @notice Leaf = keccak256(bytes.concat(keccak256(abi.encode(messageHash)))).
    function verify(uint256 batchId, bytes32 messageHash, bytes32[] calldata proof) external view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(messageHash))));
        return MerkleProof.verifyCalldata(proof, _batches[batchId].root, leaf);
    }

    function batch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function batchCount() external view returns (uint256) {
        return _batches.length;
    }

    /// @notice Publish an already-signed protocol message directly onchain, so no relay can silence a user.
    function submitMessage(uint256 fid, bytes calldata message) external authFid(fid, Scopes.ANCHOR) {
        emit EscapeHatch(fid, keccak256(message), message);
    }
}
