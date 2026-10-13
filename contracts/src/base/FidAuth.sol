// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IIdentityRegistry, IAppKeyRegistry} from "../interfaces/IProtocol.sol";

/// @notice Shared auth for protocol contracts. A call on behalf of `fid` is allowed when the
/// (meta-tx aware) sender is the fid's custody address, or an app key authorized for `scope`.
/// Calls usually arrive through the trusted ERC-2771 forwarder so the relay sponsors gas.
abstract contract FidAuth is ERC2771Context {
    error Unauthorized();
    error NotAdmin();
    error UnknownFid();

    IIdentityRegistry public immutable identity;
    IAppKeyRegistry public immutable appKeys;
    address public admin;

    event AdminChanged(address admin);

    constructor(address forwarder, address identity_, address appKeys_, address admin_) ERC2771Context(forwarder) {
        identity = IIdentityRegistry(identity_);
        appKeys = IAppKeyRegistry(appKeys_);
        admin = admin_;
    }

    modifier onlyAdmin() {
        if (_msgSender() != admin) revert NotAdmin();
        _;
    }

    modifier authFid(uint256 fid, uint32 scope) {
        _auth(fid, scope);
        _;
    }

    function setAdmin(address admin_) external onlyAdmin {
        admin = admin_;
        emit AdminChanged(admin_);
    }

    function _auth(uint256 fid, uint32 scope) internal view {
        address sender = _msgSender();
        address custody = identity.custodyOf(fid);
        if (custody == address(0)) revert UnknownFid();
        if (sender == custody) return;
        if (!appKeys.isAuthorized(fid, sender, scope)) revert Unauthorized();
    }

    function _requireFid(uint256 fid) internal view returns (address custody) {
        custody = identity.custodyOf(fid);
        if (custody == address(0)) revert UnknownFid();
    }

    function _day() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

}
