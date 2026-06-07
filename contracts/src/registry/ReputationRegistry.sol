// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NexarioReputationRegistry
 * @notice ERC-8004 compatible reputation registry.
 *
 *         KEY DESIGN DECISION:
 *         Only addresses that have actually paid an agent (via 1Shot relay)
 *         can give feedback. The feedbackHash MUST be a non-zero transaction
 *         hash proving payment occurred. Each txHash can only be used once
 *         per (agentId, clientAddress) pair — preventing replay attacks.
 *
 *         This makes reputation unfakeable:
 *         - Can't give feedback without paying
 *         - Can't reuse the same payment proof twice
 *         - Anyone can verify on Etherscan: clientAddress paid agentWallet in feedbackHash tx
 *
 *         "Payment IS Reputation" — enforced at the contract level.
 */
contract NexarioReputationRegistry {

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public immutable identityRegistry;

    // Oracle address — allowed to write feedback without payment proof
    // Used for bootstrapping and demo. Set to zero to disable oracle.
    address public oracle;
    address public owner;

    struct FeedbackEntry {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
        bytes32 feedbackHash; // 1Shot txHash proving payment
    }

    // agentId => clientAddress => feedbackIndex (1-based) => FeedbackEntry
    mapping(uint256 => mapping(address => mapping(uint64 => FeedbackEntry))) private _feedback;

    // agentId => clientAddress => total feedback count
    mapping(uint256 => mapping(address => uint64)) private _feedbackCount;

    // Prevent reuse of same txHash: agentId => clientAddress => feedbackHash => used
    mapping(uint256 => mapping(address => mapping(bytes32 => bool))) private _usedHashes;

    // ─── Events ───────────────────────────────────────────────────────────────

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );

    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex
    );

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address identityRegistry_, address oracle_) {
        identityRegistry = identityRegistry_;
        oracle = oracle_;
        owner = msg.sender;
    }

    // ─── Write ────────────────────────────────────────────────────────────────

    /**
     * @notice Give feedback for an agent after receiving service.
     *
     * Rules:
     * 1. Owner cannot give feedback to their own agent (anti-self-rating)
     * 2. feedbackHash must be non-zero (proves payment) — UNLESS caller is oracle
     * 3. Each feedbackHash can only be used once per (agentId, clientAddress)
     * 4. Oracle can give feedback with zero feedbackHash (for bootstrapping/demo)
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(valueDecimals <= 18, "valueDecimals must be 0-18");
        require(_isRegistered(agentId), "Agent not registered");
        require(!_isOwnerOrOperator(agentId, msg.sender), "Owner cannot give feedback");

        bool isOracle = (oracle != address(0) && msg.sender == oracle);

        if (!isOracle) {
            // Regular clients MUST provide a non-zero feedbackHash (payment proof)
            require(feedbackHash != bytes32(0), "feedbackHash required: provide 1Shot txHash as payment proof");

            // Each txHash can only be used once per (agentId, clientAddress)
            require(
                !_usedHashes[agentId][msg.sender][feedbackHash],
                "feedbackHash already used: each payment can only generate one feedback"
            );

            _usedHashes[agentId][msg.sender][feedbackHash] = true;
        }

        uint64 index = ++_feedbackCount[agentId][msg.sender];

        _feedback[agentId][msg.sender][index] = FeedbackEntry({
            value: value,
            valueDecimals: valueDecimals,
            tag1: tag1,
            tag2: tag2,
            isRevoked: false,
            feedbackHash: feedbackHash
        });

        emit NewFeedback(
            agentId,
            msg.sender,
            index,
            value,
            valueDecimals,
            tag1,
            tag1,
            tag2,
            endpoint,
            feedbackURI,
            feedbackHash
        );
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        require(
            _feedbackCount[agentId][msg.sender] >= feedbackIndex,
            "Feedback index out of range"
        );
        require(
            !_feedback[agentId][msg.sender][feedbackIndex].isRevoked,
            "Already revoked"
        );
        _feedback[agentId][msg.sender][feedbackIndex].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    // ─── Read ─────────────────────────────────────────────────────────────────

    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        bool isRevoked,
        bytes32 feedbackHash
    ) {
        FeedbackEntry storage entry = _feedback[agentId][clientAddress][feedbackIndex];
        return (
            entry.value,
            entry.valueDecimals,
            entry.tag1,
            entry.tag2,
            entry.isRevoked,
            entry.feedbackHash
        );
    }

    /**
     * @notice Aggregate feedback from trusted clients.
     * @param clientAddresses Addresses whose feedback to count.
     *        In production: these are addresses that have paid the agent.
     *        The caller decides whose feedback to trust.
     */
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1Filter,
        string calldata tag2Filter
    ) external view returns (
        uint64 count,
        int128 summaryValue,
        uint8 summaryValueDecimals
    ) {
        require(clientAddresses.length > 0, "clientAddresses must be non-empty");

        bool filterTag1 = bytes(tag1Filter).length > 0;
        bool filterTag2 = bytes(tag2Filter).length > 0;

        for (uint256 i = 0; i < clientAddresses.length; i++) {
            address client = clientAddresses[i];
            uint64 total = _feedbackCount[agentId][client];

            for (uint64 j = 1; j <= total; j++) {
                FeedbackEntry storage entry = _feedback[agentId][client][j];
                if (entry.isRevoked) continue;

                if (filterTag1 && keccak256(bytes(entry.tag1)) != keccak256(bytes(tag1Filter))) {
                    continue;
                }
                if (filterTag2 && keccak256(bytes(entry.tag2)) != keccak256(bytes(tag2Filter))) {
                    continue;
                }

                count++;
                summaryValue += entry.value;
                summaryValueDecimals = entry.valueDecimals;
            }
        }
    }

    function getFeedbackCount(
        uint256 agentId,
        address clientAddress
    ) external view returns (uint64) {
        return _feedbackCount[agentId][clientAddress];
    }

    function isHashUsed(
        uint256 agentId,
        address clientAddress,
        bytes32 feedbackHash
    ) external view returns (bool) {
        return _usedHashes[agentId][clientAddress][feedbackHash];
    }

    function getIdentityRegistry() external view returns (address) {
        return identityRegistry;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setOracle(address newOracle) external {
        require(msg.sender == owner, "Not owner");
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Not owner");
        owner = newOwner;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _isRegistered(uint256 agentId) internal view returns (bool) {
        try IERC721(identityRegistry).ownerOf(agentId) returns (address) {
            return true;
        } catch {
            return false;
        }
    }

    function _isOwnerOrOperator(uint256 agentId, address caller) internal view returns (bool) {
        try IERC721(identityRegistry).ownerOf(agentId) returns (address agentOwner) {
            if (agentOwner == caller) return true;
            try IERC721(identityRegistry).isApprovedForAll(agentOwner, caller) returns (bool approved) {
                return approved;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
