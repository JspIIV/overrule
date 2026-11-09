// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

import { CaveatEnforcer } from "../vendor/delegation-framework/src/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "../vendor/delegation-framework/src/utils/Types.sol";

/// @title CourtEnforcer
/// @notice A MetaMask Delegation Framework caveat that puts an agent's spending under Internet Court.
///
///         The delegator writes a mandate in plain words and signs its keccak256 into this caveat's terms, so the
///         mandate is part of the signed delegation and nobody can swap it later. Every time the agent redeems the
///         delegation, this caveat records the payment (token, recipient, amount, time) and the agent's own memo, which
///         the agent passes as the caveat's args. The Overrule Intelligent Contract on GenLayer reads those records,
///         has its validators judge them against the mandate, and when the verdict is final it calls overrule() here
///         itself, through its Ghost on GenLayer Chain. From then on every redemption of that delegation reverts.
///
///         Only ERC-20 transfers are allowed through, so that every action the agent takes is a payment the court can
///         read. The hooks accept calls from the DelegationManager alone, so nobody can write a payment into the record.
///         Overrule is permanent; the delegator's own disableDelegation on the DelegationManager always works too.
contract CourtEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    struct Payment {
        address token;
        address to;
        uint256 amount;
        uint64 at;
    }

    uint256 public constant MAX_MEMO = 280;

    address public immutable manager;
    address private immutable deployer;
    address public court;

    mapping(bytes32 => bytes32) public mandateOf;
    mapping(bytes32 => address) public delegatorOf;
    mapping(bytes32 => bool) public overruled;
    mapping(bytes32 => bytes32) public overruleReason;
    mapping(bytes32 => Payment[]) private payments;
    mapping(bytes32 => mapping(uint256 => string)) private memos;

    event PaymentRecorded(bytes32 indexed delegationHash, uint256 indexed index, address token, address to, uint256 amount, string memo);
    event Overruled(bytes32 indexed delegationHash, bytes32 reason);
    event CourtSet(address court);

    constructor(address manager_) {
        manager = manager_;
        deployer = msg.sender;
    }

    /// One time wiring: the enforcer is deployed before the Intelligent Contract that judges it.
    function setCourt(address court_) external {
        require(msg.sender == deployer && court == address(0) && court_ != address(0), "CourtEnforcer:already-set");
        court = court_;
        emit CourtSet(court_);
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address _delegator,
        address
    )
        public
        override
        onlySingleCallTypeMode(_mode)
        onlyDefaultExecutionMode(_mode)
    {
        require(msg.sender == manager, "CourtEnforcer:only-manager");
        require(!overruled[_delegationHash], "CourtEnforcer:overruled");
        require(_terms.length == 32, "CourtEnforcer:invalid-terms");
        require(_args.length <= MAX_MEMO, "CourtEnforcer:memo-too-long");
        bytes32 mandate_ = bytes32(_terms);
        if (mandateOf[_delegationHash] == bytes32(0)) {
            mandateOf[_delegationHash] = mandate_;
            delegatorOf[_delegationHash] = _delegator;
        }

        _record(_delegationHash, _executionCallData, _args);
    }

    function _record(bytes32 _delegationHash, bytes calldata _executionCallData, bytes calldata _args) private {
        (address target_, uint256 value_, bytes calldata callData_) = _executionCallData.decodeSingle();
        require(value_ == 0, "CourtEnforcer:native-value");
        require(callData_.length == 68 && bytes4(callData_[0:4]) == IERC20.transfer.selector, "CourtEnforcer:only-erc20-transfer");
        Payment memory p_ = Payment(target_, address(uint160(uint256(bytes32(callData_[4:36])))), uint256(bytes32(callData_[36:68])), uint64(block.timestamp));
        uint256 index_ = payments[_delegationHash].length;
        payments[_delegationHash].push(p_);
        memos[_delegationHash][index_] = string(_args);
        emit PaymentRecorded(_delegationHash, index_, p_.token, p_.to, p_.amount, string(_args));
    }

    /// Called only by the Overrule Intelligent Contract, when its verdict is final.
    function overrule(bytes32 _delegationHash, bytes32 _reason) external {
        require(msg.sender == court, "CourtEnforcer:only-court");
        require(!overruled[_delegationHash], "CourtEnforcer:already-overruled");
        overruled[_delegationHash] = true;
        overruleReason[_delegationHash] = _reason;
        emit Overruled(_delegationHash, _reason);
    }

    /// Flat getters, for readers that decode only static tuples (an Intelligent Contract among them).
    function state(bytes32 _delegationHash) external view returns (bool overruled_, bytes32 mandate_, uint256 count_, address delegator_) {
        return (overruled[_delegationHash], mandateOf[_delegationHash], payments[_delegationHash].length, delegatorOf[_delegationHash]);
    }

    function payment(bytes32 _delegationHash, uint256 _index) external view returns (address token_, address to_, uint256 amount_, uint64 at_) {
        Payment storage p = payments[_delegationHash][_index];
        return (p.token, p.to, p.amount, p.at);
    }

    function memo(bytes32 _delegationHash, uint256 _index) external view returns (string memory) {
        return memos[_delegationHash][_index];
    }
}
