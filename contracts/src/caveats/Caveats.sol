// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NexarioCaveats
 * @notice Custom caveat enforcers for the MetaMask DelegationManager.
 *         Three caveats in one file:
 *         - BudgetCaveat: enforces USDC spend cap per delegation
 *         - TimestampCaveat: time-bound expiry
 *         - ReputationGatedCaveat: reads on-chain ERC-8004 rep before executing
 */

// ─── ICaveatEnforcer (MetaMask interface) ─────────────────────────────────────

interface ICaveatEnforcer {
    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;

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

// ─── BudgetCaveat ─────────────────────────────────────────────────────────────

/**
 * @notice Caps the total USDC that can be transferred in a delegation.
 * terms: abi.encode(uint256 maxAmountUsdc)
 */
contract BudgetCaveat is ICaveatEnforcer {
    // delegationHash => amount spent so far
    mapping(bytes32 => uint256) public spent;

    event BudgetUsed(bytes32 indexed delegationHash, uint256 amount, uint256 remaining);

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address,
        address
    ) external override {
        uint256 maxAmount = abi.decode(terms, (uint256));
        uint256 transferAmount = _extractTransferAmount(executionCalldata);

        uint256 alreadySpent = spent[delegationHash];
        require(alreadySpent + transferAmount <= maxAmount, "BudgetCaveat: budget exceeded");

        spent[delegationHash] = alreadySpent + transferAmount;

        emit BudgetUsed(delegationHash, transferAmount, maxAmount - (alreadySpent + transferAmount));
    }

    function afterHook(bytes calldata, bytes calldata, bytes32, bytes calldata, bytes32, address, address)
        external pure override {}

    // Extract transfer amount from ERC-20 transfer(address,uint256) calldata
    function _extractTransferAmount(bytes calldata calldata_) internal pure returns (uint256) {
        if (calldata_.length < 68) return 0;
        // selector(4) + address(32) + amount(32) = 68 bytes
        bytes4 selector = bytes4(calldata_[:4]);
        // ERC-20 transfer: 0xa9059cbb
        if (selector != 0xa9059cbb) return 0;
        return abi.decode(calldata_[36:68], (uint256));
    }
}

// ─── TimestampCaveat ──────────────────────────────────────────────────────────

/**
 * @notice Time-bounds a delegation to a specific window.
 * terms: abi.encode(uint128 validAfter, uint128 validUntil)
 */
contract TimestampCaveat is ICaveatEnforcer {
    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        bytes calldata,
        bytes32,
        address,
        address
    ) external view override {
        (uint128 validAfter, uint128 validUntil) = abi.decode(terms, (uint128, uint128));

        require(block.timestamp >= validAfter, "TimestampCaveat: too early");
        require(block.timestamp <= validUntil, "TimestampCaveat: expired");
    }

    function afterHook(bytes calldata, bytes calldata, bytes32, bytes calldata, bytes32, address, address)
        external pure override {}
}

// ─── ReputationGatedCaveat ────────────────────────────────────────────────────

/**
 * @notice Gates delegation execution on the agent's on-chain reputation.
 *         Reads from NexarioReputationRegistry before allowing execution.
 *         This is the novel caveat — combines ERC-7710 with ERC-8004.
 *
 * terms: abi.encode(
 *   address reputationRegistry,
 *   uint256 agentId,
 *   address[] trustedClients,    // who's feedback to count
 *   string tag1,                 // e.g. "successRate"
 *   int128 minValue,             // minimum required value
 *   uint64 minCount              // minimum feedback count
 * )
 */
contract ReputationGatedCaveat is ICaveatEnforcer {

    error ReputationTooLow(int128 actual, int128 required);
    error InsufficientFeedbackCount(uint64 actual, uint64 required);

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        bytes calldata,
        bytes32,
        address,
        address redeemer
    ) external view override {
        (
            address registry,
            uint256 agentId,
            address[] memory trustedClients,
            string memory tag1,
            int128 minValue,
            uint64 minCount
        ) = abi.decode(terms, (address, uint256, address[], string, int128, uint64));

        IReputationRegistry rep = IReputationRegistry(registry);

        (uint64 count, int128 summaryValue,) = rep.getSummary(
            agentId,
            trustedClients,
            tag1,
            ""
        );

        if (count < minCount) {
            revert InsufficientFeedbackCount(count, minCount);
        }

        int128 avgValue = count > 0 ? summaryValue / int128(uint128(count)) : int128(0);
        if (avgValue < minValue) {
            revert ReputationTooLow(avgValue, minValue);
        }
    }

    function afterHook(bytes calldata, bytes calldata, bytes32, bytes calldata, bytes32, address, address)
        external pure override {}
}

// ─── ActionScopeCaveat ────────────────────────────────────────────────────────

/**
 * @notice Restricts which function selectors can be called.
 * terms: abi.encode(bytes4[] allowedSelectors)
 */
contract ActionScopeCaveat is ICaveatEnforcer {
    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        bytes calldata executionCalldata,
        bytes32,
        address,
        address
    ) external pure override {
        bytes4[] memory allowed = abi.decode(terms, (bytes4[]));

        if (executionCalldata.length < 4) return;
        bytes4 selector = bytes4(executionCalldata[:4]);

        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == selector) return;
        }

        revert("ActionScopeCaveat: selector not allowed");
    }

    function afterHook(bytes calldata, bytes calldata, bytes32, bytes calldata, bytes32, address, address)
        external pure override {}
}

interface IReputationRegistry {
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1Filter,
        string calldata tag2Filter
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}
