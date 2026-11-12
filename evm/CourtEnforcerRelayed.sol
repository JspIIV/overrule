// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

import { CaveatEnforcer } from "../vendor/delegation-framework/src/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "../vendor/delegation-framework/src/utils/Types.sol";

/// @title CourtEnforcerRelayed
/// @notice The CourtEnforcer for chains an Intelligent Contract cannot call directly, such as Base Sepolia, where it
///         runs beside MetaMask's own deployment of the Delegation Framework and real USDC.
///
///         The delegator signs two things into this caveat's terms: keccak256 of the mandate, and the carrier, the one
///         address they trust to bring Internet Court's verdict from GenLayer to this chain. Every redemption is
///         recorded with the agent's memo and emitted as an event, which the Overrule court on GenLayer reads from a
///         public explorer. When the court rules OVERRULE and its verdict is final, the carrier, or the delegator
///         themselves, calls overrule() with the court's reason, and every later redemption reverts.
///
///         What the carrier can do is narrow on purpose: it can only end the delegation, never move money or loosen a
///         limit, and the delegator could end it themselves at any time. The reason it passes is the court's own
///         commitment, which anybody can compare with the case on GenLayer. This is the connector's "trusted relayer"
///         mode with the trust made as small and as checkable as this chain allows: Base cannot read GenLayer, so it
///         cannot check the verdict itself.
contract CourtEnforcerRelayed is CaveatEnforcer {
    using ExecutionLib for bytes;

    struct Payment {
        address token;
        address to;
        uint256 amount;
        uint64 at;
    }

    uint256 public constant MAX_MEMO = 280;

    address public immutable manager;

    mapping(bytes32 => bytes32) public mandateOf;
    mapping(bytes32 => address) public delegatorOf;
    mapping(bytes32 => address) public carrierOf;
    mapping(bytes32 => bool) public overruled;
    mapping(bytes32 => bytes32) public overruleReason;
    mapping(bytes32 => Payment[]) private payments;
    mapping(bytes32 => mapping(uint256 => string)) private memos;

    event Bound(bytes32 indexed delegationHash, bytes32 mandate, address delegator, address carrier);
    event PaymentRecorded(bytes32 indexed delegationHash, uint256 indexed index, address token, address to, uint256 amount, string memo);
    event Overruled(bytes32 indexed delegationHash, bytes32 reason, address by);

    constructor(address manager_) {
        manager = manager_;
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
        require(_terms.length == 64, "CourtEnforcer:invalid-terms");
        require(_args.length <= MAX_MEMO, "CourtEnforcer:memo-too-long");
        if (mandateOf[_delegationHash] == bytes32(0)) {
            (bytes32 mandate_, address carrier_) = abi.decode(_terms, (bytes32, address));
            require(mandate_ != bytes32(0) && carrier_ != address(0), "CourtEnforcer:invalid-terms");
            mandateOf[_delegationHash] = mandate_;
            delegatorOf[_delegationHash] = _delegator;
            carrierOf[_delegationHash] = carrier_;
            emit Bound(_delegationHash, mandate_, _delegator, carrier_);
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

    /// Called by the carrier the delegator signed, or by the delegator, once the court's OVERRULE is final.
    function overrule(bytes32 _delegationHash, bytes32 _reason) external {
        require(mandateOf[_delegationHash] != bytes32(0), "CourtEnforcer:unknown-delegation");
        require(msg.sender == carrierOf[_delegationHash] || msg.sender == delegatorOf[_delegationHash], "CourtEnforcer:only-carrier");
        require(!overruled[_delegationHash], "CourtEnforcer:already-overruled");
        require(_reason != bytes32(0), "CourtEnforcer:no-reason");
        overruled[_delegationHash] = true;
        overruleReason[_delegationHash] = _reason;
        emit Overruled(_delegationHash, _reason, msg.sender);
    }

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
