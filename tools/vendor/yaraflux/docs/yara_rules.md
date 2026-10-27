# YARA Rules Guide

This guide covers creating, managing, and optimizing YARA rules in YaraFlux.

## YARA Rule Basics

### Rule Structure
```yara
rule rule_name {
    meta:
        description = "Rule description"
        author = "Author name"
        date = "2025-03-07"
        version = "1.0"
    
    strings:
        $string1 = "suspicious_text" nocase
        $string2 = { 45 76 69 6C } // hex pattern
        $regex1 = /suspicious[0-9]+/ nocase
    
    condition:
        any of them
}
```

### Rule Components

1. **Rule Header**
   - Unique name using alphanumeric characters and underscores
   - Optional tags in square brackets

2. **Meta Section**
   - Additional information about the rule
   - Key-value pairs for documentation
   - Common fields: description, author, date, version, reference

3. **Strings Section**
   - Text strings
   - Hexadecimal patterns
   - Regular expressions
   - Modifiers: nocase, wide, ascii, fullword

4. **Condition Section**
   - Boolean expression determining match
   - Operators: and, or, not
   - Functions: any, all, them
   - String count operations
   - File property checks

## Best Practices

### Naming Conventions
- Use descriptive, unique names
- Follow pattern: category_threat_detail
- Example: `ransomware_lockbit_config`

### String Definition
```yara
rule good_strings {
    strings:
        // Text strings with modifiers
        $text1 = "malicious" nocase fullword
        $text2 = "evil" wide nocase
        
        // Hex patterns with wildcards
        $hex1 = { 45 ?? 69 6C }
        
        // Regular expressions
        $re1 = /suspicious[A-F0-9]{4}/
}
```

### Effective Conditions
```yara
rule good_conditions {
    condition:
        // Count matches
        #text1 > 2 and
        
        // Position checks
        @text1 < @text2 and
        
        // File size checks
        filesize < 1MB and
        
        // String presence
        $hex1 and
        
        // Multiple strings
        2 of ($text*)
}
```

## Advanced Features

### Private Rules
```yara
private rule SharedCode {
    strings:
        $code = { 45 76 69 6C }
    condition:
        $code
}

rule DetectMalware {
    condition:
        SharedCode and filesize < 1MB
}
```

### Global Rules
```yara
global rule FileCheck {
    condition:
        filesize < 10MB
}
```

### External Variables
```yara
rule ConfigCheck {
    condition:
        ext_var == "expected_value"
}
```

## Performance Optimization

1. **String Pattern Order**
   - Put most specific patterns first
   - Use anchored patterns when possible

2. **Condition Optimization**
   - Use early exit conditions
   - Order conditions by computational cost

Example:
```yara
rule optimized {
    strings:
        $specific = "exact_match"
        $general = /suspicious.*pattern/
    
    condition:
        filesize < 1MB and  // Quick check first
        $specific and       // Specific match next
        $general           // Expensive regex last
}
```

## Testing Rules

### Validation
```bash
# Validate single rule
yaraflux rules validate --file rule.yar

# Validate rule content directly
yaraflux rules validate --content 'rule test { condition: true }'
```

### Test Scanning
```bash
# Create test file
echo "Test content" > test.txt

# Scan with specific rule
yaraflux scan url file://test.txt --rules test_rule
```

## Managing Rules

### Sources
1. **Custom Rules**
   - Local rules you create
   - Stored in custom rules directory

2. **Community Rules**
   - Imported from trusted sources
   - Read-only by default

### Organization
- Group related rules in files
- Use consistent naming
- Document with metadata
- Version control rules

### Maintenance
- Regular review and updates
- Remove outdated rules
- Track false positives/negatives
- Document changes

## Examples

### Malware Detection
```yara
rule detect_malware {
    meta:
        description = "Detect common malware patterns"
        author = "YaraFlux"
        version = "1.0"
    
    strings:
        $sus1 = "cmd.exe /c" nocase
        $sus2 = "powershell.exe -enc" nocase
        $sus3 = { 68 74 74 70 3A 2F 2F } // "http://"
    
    condition:
        2 of them
}
```

### File Type Detection
```yara
rule detect_pe {
    meta:
        description = "Detect PE files"
    
    strings:
        $mz = { 4D 5A }
        $pe = { 50 45 00 00 }
    
    condition:
        $mz at 0 and $pe
}
```

### Complex Conditions
```yara
rule complex_detection {
    meta:
        description = "Advanced detection example"
    
    strings:
        $config = { 43 4F 4E 46 49 47 }
        $encrypt = /encrypt[a-z]+/
        $key = /key=[A-F0-9]{32}/
    
    condition:
        filesize < 1MB and
        $config and
        (#encrypt > 2 or $key)
}
