// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title NexarioAgentRegistry
 * @notice ERC-8004 compatible identity registry for autonomous agents.
 *         Every agent gets a portable ERC-721 NFT identity.
 *         Permissionless — any address can register.
 */
contract NexarioAgentRegistry is ERC721URIStorage, EIP712, Ownable {
    using ECDSA for bytes32;

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 private _nextAgentId;

    // agentId => wallet address (where agent receives payments)
    mapping(uint256 => address) private _agentWallets;

    // agentId => metadataKey => metadataValue
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    // Reserved metadata key — cannot be set via setMetadata
    string private constant AGENT_WALLET_KEY = "agentWallet";

    bytes32 private constant SET_WALLET_TYPEHASH =
        keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline)");

    // ─── Events ───────────────────────────────────────────────────────────────

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event AgentWalletSet(uint256 indexed agentId, address indexed newWallet);
    event AgentWalletUnset(uint256 indexed agentId);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor()
        ERC721("Nexario Agent", "NAGENT")
        EIP712("NexarioAgentRegistry", "1")
        Ownable(msg.sender)
    {
        _nextAgentId = 1;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    function register(
        string calldata agentURI,
        bytes calldata /* metadata — future extension */
    ) external returns (uint256 agentId) {
        return _register(msg.sender, agentURI);
    }

    function register(string calldata agentURI) external returns (uint256 agentId) {
        return _register(msg.sender, agentURI);
    }

    function register() external returns (uint256 agentId) {
        return _register(msg.sender, "");
    }

    function _register(address owner, string memory agentURI) internal returns (uint256 agentId) {
        agentId = _nextAgentId++;
        _mint(owner, agentId);

        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        // Initialize agentWallet to owner
        _agentWallets[agentId] = owner;

        emit Registered(agentId, agentURI, owner);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(
            ownerOf(agentId) == msg.sender || isApprovedForAll(ownerOf(agentId), msg.sender),
            "Not authorized"
        );
        _setTokenURI(agentId, newURI);
        emit MetadataSet(agentId, "agentURI", "agentURI", bytes(newURI));
    }

    // ─── Agent wallet ─────────────────────────────────────────────────────────

    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(block.timestamp <= deadline, "Signature expired");
        require(newWallet != address(0), "Zero address");

        bytes32 structHash = keccak256(
            abi.encode(SET_WALLET_TYPEHASH, agentId, newWallet, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);

        require(signer == newWallet, "Signature must be from newWallet");

        _agentWallets[agentId] = newWallet;
        emit AgentWalletSet(agentId, newWallet);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        require(_ownerOf(agentId) != address(0), "Agent not registered");
        address wallet = _agentWallets[agentId];
        return wallet != address(0) ? wallet : ownerOf(agentId);
    }

    function unsetAgentWallet(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        delete _agentWallets[agentId];
        emit AgentWalletUnset(agentId);
    }

    // ─── On-chain metadata ────────────────────────────────────────────────────

    function setMetadata(
        uint256 agentId,
        string calldata metadataKey,
        bytes calldata metadataValue
    ) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(
            keccak256(bytes(metadataKey)) != keccak256(bytes(AGENT_WALLET_KEY)),
            "Use setAgentWallet for agentWallet key"
        );

        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    function getMetadata(
        uint256 agentId,
        string calldata metadataKey
    ) external view returns (bytes memory) {
        return _metadata[agentId][metadataKey];
    }

    // ─── Transfer hook — clear agentWallet on transfer ────────────────────────

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            // Ownership transfer — clear wallet, new owner must re-verify
            delete _agentWallets[tokenId];
            emit AgentWalletUnset(tokenId);
        }
        return from;
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    function getIdentityRegistry() external view returns (address) {
        return address(this);
    }
}
