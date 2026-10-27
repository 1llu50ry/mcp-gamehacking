#!/usr/bin/env python3
"""
Simple DBEngine Cheat Table Address Extractor
Focuses on extracting and displaying memory addresses from cheat tables
"""

import logging
import sys
import os
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SimpleAddressExtractor:
    """Simple extractor for cheat table memory addresses"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            from cheatengine.table_parser import CheatTableParser
            self.table_parser = CheatTableParser()
            logger.info("✅ Table parser initialized")
        except ImportError as e:
            logger.error(f"❌ Failed to import table parser: {e}")
            raise
    
    def extract_addresses(self, cheat_table_path: str):
        """Extract and display complete address list with Description, Address, and Type"""
        try:
            logger.info(f"📋 Loading cheat table: {cheat_table_path}")
            
            # Check if file exists
            if not Path(cheat_table_path).exists():
                logger.error(f"❌ File not found: {cheat_table_path}")
                return
            
            # Parse cheat table
            cheat_table = self.table_parser.parse_file(cheat_table_path)
            
            if not cheat_table:
                logger.error("❌ Failed to parse cheat table")
                return
            
            # Get all addressable entries
            address_entries = [e for e in cheat_table.entries if e.address and not e.group_header]
            
            if not address_entries:
                print("❌ No memory addresses found in cheat table")
                return
            
            # Display header
            print("\\n" + "="*80)
            print("� COMPLETE ADDRESS LIST FROM DIABLO II.CT")
            print("="*80)
            print(f"📁 File: {Path(cheat_table_path).name}")
            print(f"📋 Table: {cheat_table.title or 'Binary Cheat Table'}")
            print(f"� Total Addressable Entries: {len(address_entries)}")
            print("="*80)
            
            # Display complete address list with Description, Address, and Type
            print(f"{'#':<4} {'ADDRESS':<12} {'TYPE':<15} {'DESCRIPTION'}")
            print("-" * 80)
            
            for i, entry in enumerate(address_entries, 1):
                address_hex = f"0x{entry.address:X}"
                entry_type = entry.variable_type or "Unknown"
                description = entry.description or f"Entry_{i}"
                
                # Truncate description if too long
                if len(description) > 45:
                    description = description[:42] + "..."
                
                print(f"{i:<4} {address_hex:<12} {entry_type:<15} {description}")
            
            # Display unique addresses summary
            unique_addresses = []
            seen_addresses = set()
            for entry in address_entries:
                if entry.address not in seen_addresses:
                    unique_addresses.append(entry.address)
                    seen_addresses.add(entry.address)
            
            print("\\n" + "="*80)
            print("📊 COMPLETE ADDRESS SUMMARY")
            print("="*80)
            print(f"Total entries with addresses: {len(address_entries)}")
            print(f"Unique addresses: {len(unique_addresses)}")
            
            # Show all unique addresses in hex format
            print("\\n🎯 ALL UNIQUE ADDRESSES:")
            print("-" * 40)
            hex_addresses = [f"0x{addr:X}" for addr in sorted(unique_addresses)]
            
            # Display in rows of 6 for better readability
            for i in range(0, len(hex_addresses), 6):
                row_addresses = hex_addresses[i:i+6]
                print("  " + "  ".join(f"{addr:>6}" for addr in row_addresses))
            
            # Copy-paste format
            print(f"\\n� COPY-PASTE FORMAT:")
            print("-" * 40)
            print(", ".join(hex_addresses))
            
            # Range analysis
            if unique_addresses:
                min_addr = min(unique_addresses)
                max_addr = max(unique_addresses)
                print(f"\\n📈 ADDRESS RANGE:")
                print(f"  Lowest:  0x{min_addr:X} ({min_addr})")
                print(f"  Highest: 0x{max_addr:X} ({max_addr})")
                print(f"  Span:    {max_addr - min_addr} bytes")
            
            print("\\n✅ Complete address list extraction completed!")
            
        except Exception as e:
            logger.error(f"❌ Error extracting addresses: {e}")

def main():
    """Main function"""
    print("🔍 DBEngine Cheat Table Address Extractor")
    print("="*50)
    
    # Default cheat table path
    default_path = r"C:\\Users\\benam\\Documents\\My Cheat Tables\\Diablo II.CT"
    
    # Check if file exists
    if Path(default_path).exists():
        cheat_table_path = default_path
        print(f"📁 Using default cheat table: {cheat_table_path}")
    else:
        print(f"⚠️  Default cheat table not found: {default_path}")
        print("💡 Please specify the path to your .CT file")
        
        # You can modify this path or add command line argument parsing
        cheat_table_path = input("Enter cheat table path (or press Enter to exit): ").strip()
        if not cheat_table_path:
            print("👋 Exiting...")
            return
    
    # Extract addresses
    try:
        extractor = SimpleAddressExtractor()
        extractor.extract_addresses(cheat_table_path)
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    main()
