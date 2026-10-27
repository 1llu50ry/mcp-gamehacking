# D2Docs System Hierarchy Design
## Diablo 2 Code Architecture Organization

---

## 🎯 **Overview**

This document defines the hierarchical organization of Diablo 2's codebase within the D2Docs platform. The hierarchy captures the logical organization from high-level game systems down to individual functions, enabling intelligent AI analysis and comprehensive knowledge management.

## 🌳 **Hierarchical Architecture**

### **Level 0: Game Systems (Top-Level)**
The highest level represents major game systems that define core gameplay mechanics.

```
🎮 DIABLO 2 GAME SYSTEMS
├── 👤 Player System
├── ⚔️ Combat System
├── 🌍 World/Level System
├── 📦 Item System
├── 🔗 Network/Multiplayer System
├── 🎨 Graphics/Rendering System
├── 🔊 Audio System
└── 🖥️ User Interface System
```

### **Level 1: Subsystems (System Components)**
Each system contains specialized subsystems handling specific aspects of functionality.

#### **👤 Player System**
```
Player System
├── 📊 Character Progression Subsystem
├── 🎒 Inventory Management Subsystem
├── 💪 Attribute/Stat Subsystem
├── 🌟 Skill Tree Subsystem
├── 🎭 Character State Subsystem
└── 🏃 Movement/Physics Subsystem
```

#### **⚔️ Combat System**
```
Combat System
├── 💥 Damage Calculation Subsystem
├── 🛡️ Defense/Armor Subsystem
├── 🎯 Targeting/AI Subsystem
├── ⚡ Skill Effects Subsystem
├── 🩸 Status Effects Subsystem
└── 💀 Death/Resurrection Subsystem
```

#### **🌍 World/Level System**
```
World/Level System
├── 🗺️ Map Generation Subsystem
├── 🚪 Level Transition Subsystem
├── 🎮 Game State Management Subsystem
├── 📍 Object Placement Subsystem
├── 🌤️ Environment/Weather Subsystem
└── 💡 Lighting Subsystem
```

#### **📦 Item System**
```
Item System
├── 🎲 Item Generation Subsystem
├── 📊 Item Properties Subsystem
├── 🔮 Magic/Rare Item Subsystem
├── 📈 Item Upgrading Subsystem
├── 💎 Gem/Rune Subsystem
└── 🏪 Trading/Economy Subsystem
```

### **Level 2: Modules (Implementation Units)**
Modules represent cohesive units of functionality within subsystems, typically corresponding to logical code groupings.

#### **📊 Character Progression Subsystem Modules**
```
Character Progression Subsystem
├── 📈 Experience/Leveling Module
│   ├── Binary: D2Game.dll
│   ├── Functions: CalculateExperience(), ApplyLevelUp(), UpdateCharacterStats()
│   └── Purpose: Handle character experience gain and level progression
├── 🌟 Skill Tree Module
│   ├── Binary: D2Game.dll + D2Common.dll
│   ├── Functions: GetSkillLevel(), AllocateSkillPoint(), ProcessSkillCooldown()
│   └── Purpose: Manage skill trees, point allocation, and skill effects
└── 📋 Stat Calculation Module
    ├── Binary: D2Common.dll
    ├── Functions: CalculateBaseStat(), ApplyItemModifiers(), GetEffectiveStat()
    └── Purpose: Calculate final character statistics from base + modifiers
```

#### **🎒 Inventory Management Subsystem Modules**
```
Inventory Management Subsystem
├── 📦 Item Storage Module
│   ├── Binary: D2Game.dll
│   ├── Functions: AddItemToInventory(), RemoveItemFromInventory(), ValidateInventorySpace()
│   └── Purpose: Handle item placement, removal, and inventory validation
├── ⚖️ Item Properties Module
│   ├── Binary: D2Common.dll
│   ├── Functions: GetItemStats(), CalculateItemValue(), GetItemDescription()
│   └── Purpose: Retrieve and calculate item properties and descriptions
└── 🔄 Item State Module
    ├── Binary: D2Game.dll
    ├── Functions: SetItemState(), GetItemState(), ValidateItemState()
    └── Purpose: Manage item states (equipped, identified, socketed, etc.)
```

## 🗄️ **Database Schema Implementation**

### **Systems Table**
```sql
CREATE TABLE d2_systems (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,           -- "Player System"
    description TEXT,                            -- High-level purpose
    system_embedding vector(1536),              -- AI-generated semantic vector
    parent_system_id INTEGER REFERENCES d2_systems(id), -- For nested systems
    level INTEGER DEFAULT 0,                    -- 0=System, 1=Subsystem, 2=Module
    created_date TIMESTAMP DEFAULT NOW(),
    updated_date TIMESTAMP DEFAULT NOW()
);

-- Example data
INSERT INTO d2_systems (name, description, level) VALUES
('Player System', 'Core player character management including progression, inventory, and attributes', 0),
('Combat System', 'All combat-related functionality including damage, targeting, and effects', 0),
('World/Level System', 'World generation, level management, and environmental systems', 0);
```

### **Subsystems Table**
```sql
CREATE TABLE d2_subsystems (
    id SERIAL PRIMARY KEY,
    system_id INTEGER NOT NULL REFERENCES d2_systems(id),
    name VARCHAR(255) NOT NULL,                  -- "Character Progression"
    description TEXT,                            -- Detailed subsystem purpose
    binary_files TEXT[],                         -- ["D2Game.dll", "D2Common.dll"]
    subsystem_embedding vector(1536),           -- AI-generated semantic vector
    created_date TIMESTAMP DEFAULT NOW()
);

-- Example data
INSERT INTO d2_subsystems (system_id, name, description, binary_files) VALUES
(1, 'Character Progression Subsystem', 'Handles experience, leveling, and character advancement', ARRAY['D2Game.dll']),
(1, 'Inventory Management Subsystem', 'Manages player inventory, item storage, and organization', ARRAY['D2Game.dll', 'D2Common.dll']);
```

### **Modules Table**
```sql
CREATE TABLE d2_modules (
    id SERIAL PRIMARY KEY,
    subsystem_id INTEGER NOT NULL REFERENCES d2_subsystems(id),
    name VARCHAR(255) NOT NULL,                  -- "Experience/Leveling Module"
    description TEXT,                            -- Module-level functionality description
    primary_binary VARCHAR(100),                -- Main implementing DLL
    module_embedding vector(1536),              -- AI-generated semantic vector
    created_date TIMESTAMP DEFAULT NOW()
);

-- Example data
INSERT INTO d2_modules (subsystem_id, name, description, primary_binary) VALUES
(1, 'Experience/Leveling Module', 'Calculate experience gains, level ups, and stat point allocation', 'D2Game.dll'),
(1, 'Skill Tree Module', 'Manage skill trees, skill point allocation, and skill effects', 'D2Game.dll');
```

### **Function Hierarchy Linking**
```sql
-- Extend existing function knowledge table to link to hierarchy
ALTER TABLE community_function_knowledge
ADD COLUMN module_id INTEGER REFERENCES d2_modules(id),
ADD COLUMN system_context TEXT; -- Auto-generated context description

-- Example linking
UPDATE community_function_knowledge
SET module_id = 1,
    system_context = 'Player System → Character Progression → Experience/Leveling'
WHERE function_name IN ('CalculateExperience', 'ApplyLevelUp', 'UpdateCharacterStats');
```

## 🤖 **AI-Powered Hierarchy Discovery**

### **Automated Classification System**
```python
class HierarchyClassifier:
    """
    AI-powered system to automatically classify functions into hierarchy
    """

    async def classify_function(self, function_data):
        """
        Use Claude Opus 4.6 to analyze function and determine hierarchy placement

        Args:
            function_data: {
                'name': 'CalculateExperience',
                'decompiled_code': '...',
                'callers': [...],
                'callees': [...],
                'binary': 'D2Game.dll',
                'community_knowledge': {...}
            }

        Returns:
            classification: {
                'system': 'Player System',
                'subsystem': 'Character Progression Subsystem',
                'module': 'Experience/Leveling Module',
                'confidence': 0.95,
                'reasoning': 'Function handles experience point calculation...'
            }
        """
        analysis_prompt = f"""
        Analyze this Diablo 2 function and classify it into the game's architecture hierarchy.

        Function: {function_data['name']}
        Binary: {function_data['binary']}

        Decompiled Code:
        {function_data['decompiled_code'][:1000]}...

        Context:
        - Called by: {', '.join(function_data['callers'][:5])}
        - Calls: {', '.join(function_data['callees'][:5])}

        Based on the D2 hierarchy:
        - Systems: Player, Combat, World/Level, Item, Network, Graphics, Audio, UI
        - Subsystems: (see hierarchy above)
        - Modules: Implementation units within subsystems

        Classify this function and explain your reasoning.
        """

        response = await self.opus_client.classify(analysis_prompt)
        return self.parse_classification_response(response)

    async def build_system_relationships(self, functions_by_module):
        """
        Analyze cross-module function calls to build interaction graph
        """
        interactions = []

        for module_a, functions_a in functions_by_module.items():
            for function in functions_a:
                for callee in function.callees:
                    module_b = await self.find_function_module(callee)
                    if module_b and module_b != module_a:
                        interactions.append({
                            'from_module': module_a,
                            'to_module': module_b,
                            'interaction_type': 'calls',
                            'function': function.name,
                            'target': callee
                        })

        return self.analyze_interaction_patterns(interactions)
```

### **Knowledge Integration Pipeline**
```python
async def integrate_community_knowledge():
    """
    Process community knowledge and integrate with hierarchy
    """

    # 1. Analyze community function descriptions for system context
    community_functions = await get_community_functions()

    for func in community_functions:
        # Use AI to extract system context from community descriptions
        context = await extract_system_context(func.community_description)

        # Find or create appropriate hierarchy placement
        hierarchy_placement = await find_hierarchy_placement(
            function_name=func.function_name,
            binary=func.binary_name,
            community_context=context,
            existing_analysis=func.ghidra_analysis
        )

        # Update function with hierarchy information
        await update_function_hierarchy(func.id, hierarchy_placement)

    # 2. Generate system embeddings for semantic search
    await generate_hierarchy_embeddings()

    # 3. Build interaction graph
    await build_system_interaction_graph()
```

## 🔍 **Hierarchy-Aware Search**

### **Semantic Search Integration**
```python
class HierarchicalSearch:
    """
    Search that understands D2's system hierarchy
    """

    async def search_by_system(self, query, system_filter=None):
        """
        Search within specific system or across all systems

        Examples:
        - "inventory functions" → Search within Item System + Player System
        - "damage calculation" → Search within Combat System
        - "level generation" → Search within World/Level System
        """

        # 1. Classify query intent
        search_intent = await self.classify_search_intent(query)

        # 2. Determine relevant systems/subsystems
        relevant_systems = await self.find_relevant_systems(
            query, search_intent, system_filter
        )

        # 3. Perform vector search within relevant scope
        results = await self.vector_search_scoped(
            query_embedding=await self.embed_query(query),
            system_scope=relevant_systems,
            confidence_threshold=0.7
        )

        # 4. Rank results by hierarchy relevance
        return self.rank_by_hierarchy_relevance(results, search_intent)

    async def find_similar_across_systems(self, function_id):
        """
        Find similar functions across different systems (cross-cutting concerns)
        """
        function = await self.get_function_with_hierarchy(function_id)

        # Search for similar functions in:
        # 1. Same module (highest relevance)
        # 2. Same subsystem (high relevance)
        # 3. Same system (medium relevance)
        # 4. Different systems (cross-cutting patterns)

        similar_functions = []

        for scope in ['module', 'subsystem', 'system', 'global']:
            scope_results = await self.find_similar_in_scope(
                function, scope, limit=10
            )
            similar_functions.extend(scope_results)

        return self.deduplicate_and_rank(similar_functions)
```

## 📊 **Hierarchy Visualization**

### **Interactive System Browser**
```javascript
// Frontend component for browsing D2 system hierarchy
class SystemHierarchyBrowser extends React.Component {
    renderSystemTree() {
        return (
            <TreeView>
                {this.state.systems.map(system => (
                    <TreeNode
                        key={system.id}
                        label={system.name}
                        icon={this.getSystemIcon(system.name)}
                        onClick={() => this.expandSystem(system)}
                    >
                        {system.subsystems.map(subsystem => (
                            <TreeNode
                                key={subsystem.id}
                                label={subsystem.name}
                                onClick={() => this.expandSubsystem(subsystem)}
                            >
                                {subsystem.modules.map(module => (
                                    <TreeNode
                                        key={module.id}
                                        label={module.name}
                                        onClick={() => this.showModuleFunctions(module)}
                                    />
                                ))}
                            </TreeNode>
                        ))}
                    </TreeNode>
                ))}
            </TreeView>
        );
    }

    async expandSystem(system) {
        // Load subsystems and modules on-demand
        const hierarchy = await this.api.getSystemHierarchy(system.id);
        this.setState({
            expandedSystems: {...this.state.expandedSystems, [system.id]: hierarchy}
        });
    }
}
```

## 🔗 **System Interaction Mapping**

### **Cross-System Dependencies**
```sql
CREATE TABLE system_interactions (
    id SERIAL PRIMARY KEY,
    system_a_id INTEGER REFERENCES d2_systems(id),
    system_b_id INTEGER REFERENCES d2_systems(id),
    interaction_type VARCHAR(50),                -- 'calls', 'depends_on', 'modifies', 'listens_to'
    description TEXT,                            -- Human-readable description
    confidence FLOAT DEFAULT 0.5,               -- Confidence in this relationship
    discovered_method VARCHAR(50),               -- 'static_analysis', 'community', 'live_analysis'
    evidence JSONB,                              -- Supporting evidence for relationship
    created_date TIMESTAMP DEFAULT NOW()
);

-- Example interactions
INSERT INTO system_interactions (system_a_id, system_b_id, interaction_type, description, confidence, discovered_method) VALUES
(1, 3, 'calls', 'Player System calls Combat System for damage calculations during skill use', 0.9, 'static_analysis'),
(2, 4, 'depends_on', 'Combat System depends on Item System for weapon damage properties', 0.95, 'static_analysis'),
(3, 5, 'modifies', 'World/Level System modifies Network System state during level transitions', 0.8, 'live_analysis');
```

### **Interaction Analysis**
```python
async def analyze_system_interactions():
    """
    Discover and analyze how D2's systems interact with each other
    """

    # 1. Static analysis - function call patterns
    call_patterns = await analyze_cross_system_calls()

    # 2. Data flow analysis - shared data structures
    data_dependencies = await analyze_shared_data_structures()

    # 3. Community knowledge - documented interactions
    community_interactions = await extract_community_interactions()

    # 4. Live analysis - runtime interaction patterns
    live_interactions = await analyze_runtime_interactions()

    # 5. Synthesize into interaction graph
    interaction_graph = await build_interaction_graph([
        call_patterns,
        data_dependencies,
        community_interactions,
        live_interactions
    ])

    return interaction_graph
```

---

## 🚀 **Implementation Strategy**

### **Phase 1: Core Hierarchy (Days 1-3)**
1. Create database schema for systems/subsystems/modules
2. Implement basic AI classification system
3. Begin manual classification of key functions

### **Phase 2: Automated Discovery (Days 4-6)**
1. Deploy AI-powered hierarchy classification
2. Process existing BSim functions through classifier
3. Build initial system interaction graph

### **Phase 3: Integration (Days 7-9)**
1. Integrate hierarchy with search system
2. Add hierarchy browser to UI
3. Enable hierarchy-aware chat queries

This hierarchical design provides the foundation for intelligent analysis and enables users to understand Diablo 2's architecture at any level of detail, from high-level system interactions down to individual function implementations.