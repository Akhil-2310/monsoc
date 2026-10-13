// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title ScoutRegistry
/// @notice Scout scores are computed by a reproducible offchain job from public data (onchain follow
/// timestamps + anchored "back"/engagement messages). Each epoch the job posts a root here, so
/// other contracts (and later, creator markets) can read a verified score.
contract ScoutRegistry {
    error NotPublisher();
    error NotAdmin();

    struct Root {
        bytes32 root;
        uint64 timestamp;
        uint64 epoch;
        string uri; // full score table, so anyone can recompute and compare
    }

    event PublisherSet(address publisher, bool allowed);
    event ScoreRootPosted(uint256 indexed index, uint64 indexed epoch, bytes32 root, string uri);

    address public admin;
    mapping(address => bool) public isPublisher;
    Root[] internal _roots;

    constructor(address admin_) {
        admin = admin_;
    }

    function setPublisher(address p, bool allowed) external {
        if (msg.sender != admin) revert NotAdmin();
        isPublisher[p] = allowed;
        emit PublisherSet(p, allowed);
    }

    function post(uint64 epoch, bytes32 root, string calldata uri) external returns (uint256 index) {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        index = _roots.length;
        _roots.push(Root(root, uint64(block.timestamp), epoch, uri));
        emit ScoreRootPosted(index, epoch, root, uri);
    }

    function latest() external view returns (Root memory r, uint256 index) {
        index = _roots.length - 1;
        r = _roots[index];
    }

    function rootCount() external view returns (uint256) {
        return _roots.length;
    }

    /// @notice Leaf = keccak256(bytes.concat(keccak256(abi.encode(fid, score)))).
    function verifyScore(uint256 index, uint256 fid, uint256 score, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(fid, score))));
        return MerkleProof.verifyCalldata(proof, _roots[index].root, leaf);
    }
}
