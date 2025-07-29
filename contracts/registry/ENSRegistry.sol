pragma solidity >=0.8.4;

import "./ENS.sol";

/// The ENS registry contract.
contract ENSRegistry is ENS {
    struct Record {
        address owner;
        address resolver;
        uint64 ttl;
    }

    mapping(bytes32 => Record) records;
    mapping(address => mapping(address => bool)) operators;
    
    // Track if a node has been registered (to prevent ownership changes)
    mapping(bytes32 => bool) private isRegistered;

    // Permits modifications only by the owner of the specified node.
    modifier authorised(bytes32 node) {
        address owner = records[node].owner;
        require(owner == msg.sender || operators[owner][msg.sender]);
        _;
    }

    /// @dev Constructs a new ENS registry.
    constructor() public {
        records[0x0].owner = msg.sender;
    }

    /// @dev Sets the record for a node.
    /// @param node The node to update.
    /// @param owner The address of the new owner.
    /// @param resolver The address of the resolver.
    /// @param ttl The TTL in seconds.
    function setRecord(
        bytes32 node,
        address owner,
        address resolver,
        uint64 ttl
    ) external virtual override {
        // Only allow initial registration
        require(!isRegistered[node], "ENSRegistry: Record already set");
        setOwner(node, owner);
        _setResolverAndTTL(node, resolver, ttl);
    }

    /// @dev Sets the record for a subnode.
    /// @param node The parent node.
    /// @param label The hash of the label specifying the subnode.
    /// @param owner The address of the new owner.
    /// @param resolver The address of the resolver.
    /// @param ttl The TTL in seconds.
    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address owner,
        address resolver,
        uint64 ttl
    ) external virtual override {
        // Disable subdomain creation
        revert("ENSRegistry: Subdomain creation not allowed");
        // bytes32 subnode = setSubnodeOwner(node, label, owner);
        // _setResolverAndTTL(subnode, resolver, ttl);
    }

    /// @dev Transfers ownership of a node to a new address. May only be called by the current owner of the node.
    /// @param node The node to transfer ownership of.
    /// @param owner The address of the new owner.
    function setOwner(
        bytes32 node,
        address owner
    ) public virtual override authorised(node) {
        bytes32 STABLE_NODE = 0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c;
        
        // Prevent ownership changes after initial registration (except for STABLE_NODE and root)
        if (node != STABLE_NODE && node != bytes32(0)) {
            require(!isRegistered[node], "ENSRegistry: Ownership change not allowed");
        }
        
        // Allow ownership changes for STABLE_NODE always
        if (node == STABLE_NODE) {
            _setOwner(node, owner);
            emit Transfer(node, owner);
            return;
        }
        
        _setOwner(node, owner);
        isRegistered[node] = true;
        emit Transfer(node, owner);
    }

    /// @dev Transfers ownership of a subnode keccak256(node, label) to a new address. May only be called by the owner of the parent node.
    /// @param node The parent node.
    /// @param label The hash of the label specifying the subnode.
    /// @param owner The address of the new owner.
    function setSubnodeOwner(
        bytes32 node,
        bytes32 label,
        address owner
    ) public virtual override authorised(node) returns (bytes32) {
        bytes32 STABLE_NODE = 0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c;
        bytes32 REVERSE_NODE = 0xa097f6721ce401e757d1223a763fef49b8b5f90bb18567ddb86fd205dff71d34; // namehash("reverse")
        bytes32 ADDR_REVERSE_NODE = 0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2; // namehash("addr.reverse")
        
        // Allow subdomain creation only from:
        // 1. Root node (0x0) - for TLD setup (.stable, .reverse)
        // 2. STABLE_NODE - for domain registration (alice.stable, bob.stable, etc)
        // 3. REVERSE_NODE - for reverse resolution setup (addr.reverse)
        // 4. ADDR_REVERSE_NODE - for individual address reverse records
        if (node != bytes32(0) && node != STABLE_NODE && node != REVERSE_NODE && node != ADDR_REVERSE_NODE) {
            revert("ENSRegistry: Subdomain creation only allowed from root, stable, reverse, or addr.reverse node");
        }
        
        bytes32 subnode = keccak256(abi.encodePacked(node, label));
        _setOwner(subnode, owner);
        emit NewOwner(node, label, owner);
        return subnode;
    }

    /// @dev Sets the resolver address for the specified node.
    /// @param node The node to update.
    /// @param resolver The address of the resolver.
    function setResolver(
        bytes32 node,
        address resolver
    ) public virtual override authorised(node) {
        emit NewResolver(node, resolver);
        records[node].resolver = resolver;
    }

    /// @dev Sets the TTL for the specified node.
    /// @param node The node to update.
    /// @param ttl The TTL in seconds.
    function setTTL(
        bytes32 node,
        uint64 ttl
    ) public virtual override authorised(node) {
        emit NewTTL(node, ttl);
        records[node].ttl = ttl;
    }

    /// @dev Enable or disable approval for a third party ("operator") to manage
    ///      all of `msg.sender`'s ENS records. Emits the ApprovalForAll event.
    /// @param operator Address to add to the set of authorized operators.
    /// @param approved True if the operator is approved, false to revoke approval.
    function setApprovalForAll(
        address operator,
        bool approved
    ) external virtual override {
        operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @dev Returns the address that owns the specified node.
    /// @param node The specified node.
    /// @return address of the owner.
    function owner(
        bytes32 node
    ) public view virtual override returns (address) {
        address addr = records[node].owner;
        if (addr == address(this)) {
            return address(0x0);
        }

        return addr;
    }

    /// @dev Returns the address of the resolver for the specified node.
    /// @param node The specified node.
    /// @return address of the resolver.
    function resolver(
        bytes32 node
    ) public view virtual override returns (address) {
        return records[node].resolver;
    }

    /// @dev Returns the TTL of a node, and any records associated with it.
    /// @param node The specified node.
    /// @return ttl of the node.
    function ttl(bytes32 node) public view virtual override returns (uint64) {
        return records[node].ttl;
    }

    /// @dev Returns whether a record has been imported to the registry.
    /// @param node The specified node.
    /// @return Bool if record exists
    function recordExists(
        bytes32 node
    ) public view virtual override returns (bool) {
        return records[node].owner != address(0x0);
    }

    /// @dev Query if an address is an authorized operator for another address.
    /// @param owner The address that owns the records.
    /// @param operator The address that acts on behalf of the owner.
    /// @return True if `operator` is an approved operator for `owner`, false otherwise.
    function isApprovedForAll(
        address owner,
        address operator
    ) external view virtual override returns (bool) {
        return operators[owner][operator];
    }

    function _setOwner(bytes32 node, address owner) internal virtual {
        records[node].owner = owner;
    }

    function _setResolverAndTTL(
        bytes32 node,
        address resolver,
        uint64 ttl
    ) internal {
        if (resolver != records[node].resolver) {
            records[node].resolver = resolver;
            emit NewResolver(node, resolver);
        }

        if (ttl != records[node].ttl) {
            records[node].ttl = ttl;
            emit NewTTL(node, ttl);
        }
    }
}
