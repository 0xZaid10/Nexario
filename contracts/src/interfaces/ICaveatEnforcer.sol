// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICaveatEnforcer
 * @notice Interface for MetaMask DelegationManager caveat enforcers.
 *         Both hooks are called atomically during redeemDelegations().
 *         beforeHook fires before execution, afterHook fires after.
 */
interface ICaveatEnforcer {
    /**
     * @notice Called before the delegated execution.
     * @param terms      ABI-encoded terms specific to this enforcer
     * @param args       Optional runtime arguments passed by the redeemer
     * @param mode       ERC-7579 execution mode bytes32
     * @param executionCalldata ABI-encoded Execution struct
     * @param delegationHash   keccak256 of the Delegation struct
     * @param delegator        The account granting authority
     * @param redeemer         The account redeeming the delegation
     */
    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;

    /**
     * @notice Called after the delegated execution completes.
     *         Use for post-execution checks and state updates.
     *         Can write to ERC-8004 reputation registry here.
     */
    function afterHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;
}
