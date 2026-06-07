// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AuthorityLeaseRegistry
 * @notice The core on-chain primitive for Nexario's authority leasing system.
 *
 *         An AuthorityLease is a bounded, time-locked, revocable grant of
 *         execution authority from a delegator to a delegate.
 *
 *         This contract makes "authority leasing" tangible — not just a name.
 *         Every lease is created, consumed, and redelegated on-chain.
 *         Judges, users, and developers can verify the full lifecycle.
 *
 *         Lifecycle:
 *           User signs ERC-7715 → createLease() → lease exists on-chain
 *           Agent executes      → consumeLease() → spent increments
 *           Agent sub-delegates → redelegate()   → child lease created
 *           User revokes        → revokeLease()  → lease invalidated
 *
 *         Integrates with:
 *           - MetaMask DelegationManager (ERC-7710) for execution
 *           - NexarioReputationRegistry (ERC-8004) for reputation gating
 *           - 1Shot relayer for gasless execution
 */
contract AuthorityLeaseRegistry {

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct AuthorityLease {
        // Identity
        bytes32 leaseId;            // keccak256(delegator, delegate, nonce)
        address delegator;          // who granted the authority
        address delegate;           // who received the authority
        bytes32 parentLeaseId;      // bytes32(0) for root leases

        // Authority bounds
        uint256 budgetUsdc;         // max USDC that can be spent (6 decimals)
        uint256 spent;              // USDC consumed so far
        uint64  expiresAt;          // unix timestamp — hard expiry
        uint8   maxDepth;           // max redelegation hops remaining
        uint16  minReputation;      // min successRate required of delegate (0-100)
        bytes32 capability;         // keccak256 of allowed capability string

        // State
        LeaseStatus status;

        // ERC-7710 integration
        bytes32 delegationHash;     // hash of the MetaMask delegation struct
        address delegationManager;  // DelegationManager that validates this lease
    }

    enum LeaseStatus {
        Active,
        Exhausted,  // budget fully consumed
        Expired,    // past expiresAt
        Revoked,    // explicitly cancelled by delegator
        Redelegated // fully sub-delegated (leaf lease consumes budget)
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    // leaseId => lease
    mapping(bytes32 => AuthorityLease) private _leases;

    // delegator => all lease IDs they created
    mapping(address => bytes32[]) private _delegatorLeases;

    // delegate => all lease IDs they hold
    mapping(address => bytes32[]) private _delegateLeases;

    // parentLeaseId => child lease IDs
    mapping(bytes32 => bytes32[]) private _childLeases;

    // delegator => nonce (for leaseId uniqueness)
    mapping(address => uint256) private _nonces;

    // Optional: reputation registry for minReputation enforcement
    address public reputationRegistry;
    address public owner;

    // ─── Events ───────────────────────────────────────────────────────────────

    event LeaseCreated(
        bytes32 indexed leaseId,
        address indexed delegator,
        address indexed delegate,
        uint256 budgetUsdc,
        uint64  expiresAt,
        bytes32 capability,
        bytes32 parentLeaseId
    );

    event LeaseConsumed(
        bytes32 indexed leaseId,
        address indexed delegate,
        uint256 amount,
        uint256 totalSpent,
        uint256 remaining
    );

    event LeaseRedelegated(
        bytes32 indexed parentLeaseId,
        bytes32 indexed childLeaseId,
        address indexed subDelegate,
        uint256 childBudget,
        uint8   childMaxDepth
    );

    event LeaseRevoked(
        bytes32 indexed leaseId,
        address indexed delegator,
        uint256 spentAtRevocation
    );

    event LeaseExhausted(bytes32 indexed leaseId);
    event LeaseExpired(bytes32 indexed leaseId);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error LeaseNotFound(bytes32 leaseId);
    error LeaseNotActive(bytes32 leaseId, LeaseStatus status);
    error LeaseExpiredError(bytes32 leaseId, uint64 expiredAt);
    error BudgetExceeded(bytes32 leaseId, uint256 requested, uint256 remaining);
    error MaxDepthReached(bytes32 leaseId);
    error ChildBudgetExceedsParent(uint256 childBudget, uint256 parentRemaining);
    error ChildExpiryExceedsParent(uint64 childExpiry, uint64 parentExpiry);
    error NotDelegator(bytes32 leaseId, address caller);
    error NotDelegate(bytes32 leaseId, address caller);
    error ReputationTooLow(address delegate, uint16 required, uint16 actual);
    error ZeroBudget();
    error ZeroAddress();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address reputationRegistry_) {
        owner = msg.sender;
        reputationRegistry = reputationRegistry_;
    }

    // ─── Core: Create ─────────────────────────────────────────────────────────

    /**
     * @notice Create a root authority lease.
     *         Called by the backend after user approves via ERC-7715.
     *         Links to the MetaMask delegation via delegationHash.
     */
    function createLease(
        address delegate,
        uint256 budgetUsdc,
        uint64  expiresAt,
        uint8   maxDepth,
        uint16  minReputation,
        string  calldata capability,
        bytes32 delegationHash,
        address delegationManager
    ) external returns (bytes32 leaseId) {
        if (delegate == address(0)) revert ZeroAddress();
        if (budgetUsdc == 0) revert ZeroBudget();
        if (expiresAt <= block.timestamp) revert LeaseExpiredError(bytes32(0), expiresAt);

        // Check delegate reputation if registry is set and minReputation > 0
        if (reputationRegistry != address(0) && minReputation > 0) {
            uint16 rep = _getReputation(delegate);
            if (rep < minReputation) revert ReputationTooLow(delegate, minReputation, rep);
        }

        leaseId = _computeLeaseId(msg.sender, delegate, _nonces[msg.sender]++);

        _leases[leaseId] = AuthorityLease({
            leaseId:           leaseId,
            delegator:         msg.sender,
            delegate:          delegate,
            parentLeaseId:     bytes32(0),
            budgetUsdc:        budgetUsdc,
            spent:             0,
            expiresAt:         expiresAt,
            maxDepth:          maxDepth,
            minReputation:     minReputation,
            capability:        keccak256(bytes(capability)),
            status:            LeaseStatus.Active,
            delegationHash:    delegationHash,
            delegationManager: delegationManager
        });

        _delegatorLeases[msg.sender].push(leaseId);
        _delegateLeases[delegate].push(leaseId);

        emit LeaseCreated(
            leaseId, msg.sender, delegate,
            budgetUsdc, expiresAt,
            keccak256(bytes(capability)), bytes32(0)
        );
    }

    // ─── Core: Consume ────────────────────────────────────────────────────────

    /**
     * @notice Record USDC consumption against a lease.
     *         Called by the delegate (agent) after executing work.
     *         Emits LeaseConsumed — verifiable proof of execution.
     */
    function consumeLease(
        bytes32 leaseId,
        uint256 amountUsdc
    ) external {
        AuthorityLease storage lease = _getActiveLease(leaseId);

        if (lease.delegate != msg.sender) revert NotDelegate(leaseId, msg.sender);

        uint256 remaining = lease.budgetUsdc - lease.spent;
        if (amountUsdc > remaining) revert BudgetExceeded(leaseId, amountUsdc, remaining);

        lease.spent += amountUsdc;

        emit LeaseConsumed(leaseId, msg.sender, amountUsdc, lease.spent, lease.budgetUsdc - lease.spent);

        // Auto-exhaust if budget fully consumed
        if (lease.spent >= lease.budgetUsdc) {
            lease.status = LeaseStatus.Exhausted;
            emit LeaseExhausted(leaseId);
        }
    }

    // ─── Core: Redelegate ────────────────────────────────────────────────────

    /**
     * @notice Sub-delegate a portion of authority to another address.
     *         Child lease CANNOT exceed parent's remaining budget or expiry.
     *         maxDepth decrements — enforces max hop count.
     *         This is the A2A coordination primitive.
     */
    function redelegate(
        bytes32 parentLeaseId,
        address subDelegate,
        uint256 childBudgetUsdc,
        uint64  childExpiresAt,
        string  calldata capability,
        bytes32 childDelegationHash
    ) external returns (bytes32 childLeaseId) {
        AuthorityLease storage parent = _getActiveLease(parentLeaseId);

        if (parent.delegate != msg.sender) revert NotDelegate(parentLeaseId, msg.sender);
        if (parent.maxDepth == 0) revert MaxDepthReached(parentLeaseId);
        if (subDelegate == address(0)) revert ZeroAddress();

        uint256 parentRemaining = parent.budgetUsdc - parent.spent;
        if (childBudgetUsdc > parentRemaining) {
            revert ChildBudgetExceedsParent(childBudgetUsdc, parentRemaining);
        }
        if (childExpiresAt > parent.expiresAt) {
            revert ChildExpiryExceedsParent(childExpiresAt, parent.expiresAt);
        }

        uint8 childMaxDepth = parent.maxDepth - 1;

        childLeaseId = _computeLeaseId(msg.sender, subDelegate, _nonces[msg.sender]++);

        _leases[childLeaseId] = AuthorityLease({
            leaseId:           childLeaseId,
            delegator:         msg.sender,
            delegate:          subDelegate,
            parentLeaseId:     parentLeaseId,
            budgetUsdc:        childBudgetUsdc,
            spent:             0,
            expiresAt:         childExpiresAt,
            maxDepth:          childMaxDepth,
            minReputation:     parent.minReputation,
            capability:        keccak256(bytes(capability)),
            status:            LeaseStatus.Active,
            delegationHash:    childDelegationHash,
            delegationManager: parent.delegationManager
        });

        _delegatorLeases[msg.sender].push(childLeaseId);
        _delegateLeases[subDelegate].push(childLeaseId);
        _childLeases[parentLeaseId].push(childLeaseId);

        emit LeaseRedelegated(
            parentLeaseId, childLeaseId,
            subDelegate, childBudgetUsdc, childMaxDepth
        );
    }

    // ─── Core: Revoke ─────────────────────────────────────────────────────────

    /**
     * @notice Revoke an active lease. Only the original delegator can revoke.
     *         Recursively marks all child leases as revoked.
     */
    function revokeLease(bytes32 leaseId) external {
        AuthorityLease storage lease = _leases[leaseId];
        if (lease.leaseId == bytes32(0)) revert LeaseNotFound(leaseId);
        if (lease.delegator != msg.sender) revert NotDelegator(leaseId, msg.sender);

        uint256 spentAtRevocation = lease.spent;
        lease.status = LeaseStatus.Revoked;

        // Recursively revoke all children
        _revokeChildren(leaseId);

        emit LeaseRevoked(leaseId, msg.sender, spentAtRevocation);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getLease(bytes32 leaseId) external view returns (AuthorityLease memory) {
        return _leases[leaseId];
    }

    function isLeaseActive(bytes32 leaseId) external view returns (bool) {
        AuthorityLease storage lease = _leases[leaseId];
        if (lease.leaseId == bytes32(0)) return false;
        if (lease.status != LeaseStatus.Active) return false;
        if (block.timestamp > lease.expiresAt) return false;
        return true;
    }

    function getRemainingBudget(bytes32 leaseId) external view returns (uint256) {
        AuthorityLease storage lease = _leases[leaseId];
        if (lease.budgetUsdc <= lease.spent) return 0;
        return lease.budgetUsdc - lease.spent;
    }

    function getChildLeases(bytes32 leaseId) external view returns (bytes32[] memory) {
        return _childLeases[leaseId];
    }

    function getDelegatorLeases(address delegator) external view returns (bytes32[] memory) {
        return _delegatorLeases[delegator];
    }

    function getDelegateLeases(address delegate) external view returns (bytes32[] memory) {
        return _delegateLeases[delegate];
    }

    /**
     * @notice Get the full ancestry chain of a lease.
     *         Returns [root, ..., parent, lease] — useful for frontend graph.
     */
    function getLeaseChain(bytes32 leaseId) external view returns (bytes32[] memory chain) {
        uint256 depth = 0;
        bytes32 current = leaseId;

        // Count depth
        while (current != bytes32(0) && _leases[current].leaseId != bytes32(0)) {
            depth++;
            current = _leases[current].parentLeaseId;
        }

        chain = new bytes32[](depth);
        current = leaseId;

        for (uint256 i = depth; i > 0; i--) {
            chain[i - 1] = current;
            current = _leases[current].parentLeaseId;
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setReputationRegistry(address registry) external {
        require(msg.sender == owner, 'Not owner');
        reputationRegistry = registry;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _getActiveLease(bytes32 leaseId) internal view returns (AuthorityLease storage) {
        AuthorityLease storage lease = _leases[leaseId];
        if (lease.leaseId == bytes32(0)) revert LeaseNotFound(leaseId);
        if (block.timestamp > lease.expiresAt) revert LeaseExpiredError(leaseId, lease.expiresAt);
        if (lease.status != LeaseStatus.Active) revert LeaseNotActive(leaseId, lease.status);
        return lease;
    }

    function _computeLeaseId(
        address delegator,
        address delegate,
        uint256 nonce
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(delegator, delegate, nonce, block.timestamp));
    }

    function _revokeChildren(bytes32 parentLeaseId) internal {
        bytes32[] storage children = _childLeases[parentLeaseId];
        for (uint256 i = 0; i < children.length; i++) {
            bytes32 childId = children[i];
            if (_leases[childId].status == LeaseStatus.Active) {
                _leases[childId].status = LeaseStatus.Revoked;
                _revokeChildren(childId); // recurse
            }
        }
    }

    function _getReputation(address delegate) internal view returns (uint16) {
        // Calls NexarioReputationRegistry.getSummary for successRate tag
        // Returns 0 if call fails (no reputation yet = no access with minReputation > 0)
        try IReputationRegistry(reputationRegistry).getSummary(
            uint256(uint160(delegate)),
            _toArray(delegate),
            'successRate',
            ''
        ) returns (uint64 count, int128 sum, uint8) {
            if (count == 0) return 0;
            return uint16(uint128(sum / int128(uint128(count))));
        } catch {
            return 0;
        }
    }

    function _toArray(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }
}

interface IReputationRegistry {
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1Filter,
        string calldata tag2Filter
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}
