# YaraFlux MCP Server Architecture

The YaraFlux MCP Server implements a modular architecture that exposes YARA scanning functionality through the Model Context Protocol (MCP). This document provides a visual representation of the architecture.

## Overall Architecture

```mermaid
graph TD
    AI[AI Assistant] <-->|Model Context Protocol| MCP[MCP Server Layer]
    MCP <--> Tools[MCP Tools Layer]
    Tools <--> Core[Core Services]
    Core <--> Storage[Storage Layer]
    
    subgraph "YaraFlux MCP Server"
        MCP
        Tools
        Core
        Storage
    end
    
    Storage <--> FS[Local Filesystem]
    Storage <-.-> S3[MinIO/S3 Storage]
    Core <--> YARA[YARA Engine]
    
    classDef external fill:#f9f,stroke:#333,stroke-width:2px;
    classDef core fill:#bbf,stroke:#333,stroke-width:1px;
    
    class AI,FS,S3,YARA external;
    class Core,Tools,MCP,Storage core;
```

## MCP Tool Structure

```mermaid
graph TD
    MCP[MCP Server] --> Base[Tool Registration]
    Base --> RT[Rule Tools]
    Base --> ST[Scan Tools]
    Base --> FT[File Tools]
    Base --> StoT[Storage Tools]
    
    RT --> RT1[list_yara_rules]
    RT --> RT2[get_yara_rule]
    RT --> RT3[validate_yara_rule]
    RT --> RT4[add_yara_rule]
    RT --> RT5[update_yara_rule]
    RT --> RT6[delete_yara_rule]
    RT --> RT7[import_threatflux_rules]
    
    ST --> ST1[scan_url]
    ST --> ST2[scan_data]
    ST --> ST3[get_scan_result]
    
    FT --> FT1[upload_file]
    FT --> FT2[get_file_info]
    FT --> FT3[list_files]
    FT --> FT4[delete_file]
    FT --> FT5[extract_strings]
    FT --> FT6[get_hex_view]
    FT --> FT7[download_file]
    
    StoT --> StoT1[get_storage_info]
    StoT --> StoT2[clean_storage]
    
    classDef tools fill:#bfb,stroke:#333,stroke-width:1px;
    class RT,ST,FT,StoT tools;
```

## Data Flow

```mermaid
sequenceDiagram
    participant AI as AI Assistant
    participant MCP as MCP Server
    participant Tool as Tool Implementation
    participant YARA as YARA Engine
    participant Storage as Storage Layer

    AI->>MCP: Call MCP Tool (e.g., scan_data)
    MCP->>Tool: Parse & Validate Parameters
    Tool->>Storage: Store Input Data
    Storage-->>Tool: File ID
    Tool->>YARA: Scan with Rules
    YARA-->>Tool: Matches & Metadata
    Tool->>Storage: Store Results
    Storage-->>Tool: Result ID
    Tool-->>MCP: Formatted Response
    MCP-->>AI: Tool Results
```

## Deployment View

```mermaid
graph TD
    User[User] <--> Claude[Claude Desktop]
    Claude <--> Docker[Docker Container]
    
    subgraph "Docker Container"
        Entry[Entrypoint Script] --> App[YaraFlux Server]
        App --> MCPS[MCP Server Process]
        App --> API[FastAPI Server]
        
        MCPS <--> FS1[Volumes: Rules]
        MCPS <--> FS2[Volumes: Samples]
        MCPS <--> FS3[Volumes: Results]
    end
    
    Claude <-.-> cMCP[Other MCP Servers]
    
    classDef external fill:#f9f,stroke:#333,stroke-width:2px;
    classDef container fill:#bbf,stroke:#333,stroke-width:1px;
    
    class User,Claude,cMCP external;
    class Docker,Entry,App,MCPS,API,FS1,FS2,FS3 container;
```

## Storage Abstraction

```mermaid
classDiagram
    class StorageBase {
        <<abstract>>
        +upload_file()
        +download_file()
        +get_file_info()
        +list_files()
        +delete_file()
        +get_storage_info()
    }
    
    class LocalStorage {
        -base_path
        +upload_file()
        +download_file()
        +get_file_info()
        +list_files()
        +delete_file()
        +get_storage_info()
    }
    
    class MinioStorage {
        -client
        -bucket
        +upload_file()
        +download_file()
        +get_file_info()
        +list_files()
        +delete_file()
        +get_storage_info()
    }
    
    StorageBase <|-- LocalStorage
    StorageBase <|-- MinioStorage
    
    class StorageFactory {
        +get_storage_client()
    }
    
    StorageFactory --> StorageBase : creates
```

This architecture provides a flexible, maintainable system that separates concerns between MCP integration, YARA functionality, and storage operations while ensuring secure, reliable operation in production environments.
