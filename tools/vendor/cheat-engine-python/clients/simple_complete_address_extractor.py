#!/usr/bin/env python3
"""
Simple Complete Address Extractor
Focused utility to extract and display complete address list from Diablo II.CT
"""

import logging
import sys
import os
from pathlib import Path
from typing import List

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SimpleCompleteAddressExtractor:
    """Simple utility to extract complete address list from cheat table"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            from cheatengine.table_parser import CheatTableParser
            self.table_parser = CheatTableParser()
            logger.info("✅ Simple Address Extractor initialized")
        except ImportError as e:
            logger.error(f"❌ Failed to import parser: {e}")
            raise

    def extract_address_data(self, table_path: str) -> List[dict]:
        """Extract complete address data from cheat table"""
        try:
            logger.info(f"📁 Loading: {table_path}")
            
            # Parse cheat table
            cheat_table = self.table_parser.parse_file(table_path)
            if not cheat_table:
                logger.error("❌ Failed to parse cheat table")
                return []
            
            # Extract address entries with all details
            address_entries = []
            for entry in cheat_table.entries:
                if entry.address and not entry.group_header:
                    # Format address as module+offset or hex
                    if hasattr(entry, 'module') and entry.module:
                        address_str = f"{entry.module}+{entry.address:X}"
                    else:
                        address_str = f"0x{entry.address:X}"
                    
                    address_info = {
                        'address': address_str,
                        'address_hex': f"0x{entry.address:X}",
                        'type': entry.variable_type or "4 Bytes",
                        'description': entry.description or "Address from binary table",
                        'enabled': entry.enabled
                    }
                    address_entries.append(address_info)
            
            return address_entries
            
        except Exception as e:
            logger.error(f"❌ Error extracting addresses: {e}")
            return []

    def display_complete_list(self, address_entries: List[dict]):
        """Display the complete address list in the requested format"""
        logger.info("=" * 90)
        logger.info("📍 COMPLETE ADDRESS LIST FROM DIABLO II.CT")
        logger.info("=" * 90)
        
        if not address_entries:
            logger.info("❌ No addresses found")
            return
        
        logger.info(f"📊 Total addressable entries: {len(address_entries)}")
        logger.info("")
        
        # Display header in the exact format requested
        print(f"{'#':<4} {'ADDRESS':<20} {'TYPE':<15} {'ENABLED':<8} {'DESCRIPTION'}")
        print("-" * 90)
        
        # Display each entry
        for i, entry in enumerate(address_entries, 1):
            enabled_status = "Yes" if entry['enabled'] else "No"
            description = entry['description'][:40] + "..." if len(entry['description']) > 40 else entry['description']
            
            print(f"{i:<4} {entry['address']:<20} {entry['type']:<15} {enabled_status:<8} {description}")
        
        # Summary section
        logger.info("")
        logger.info("=" * 90)
        logger.info("📊 SUMMARY")
        logger.info("=" * 90)
        
        # Get unique addresses for summary
        unique_addresses = []
        seen_addresses = set()
        for entry in address_entries:
            if entry['address_hex'] not in seen_addresses:
                unique_addresses.append(entry['address_hex'])
                seen_addresses.add(entry['address_hex'])
        
        logger.info(f"Total entries: {len(address_entries)}")
        logger.info(f"Unique addresses: {len(unique_addresses)}")
        
        # Display unique addresses
        logger.info("")
        logger.info("🎯 ALL UNIQUE ADDRESSES:")
        logger.info("-" * 50)
        
        # Show addresses in rows of 6
        for i in range(0, len(unique_addresses), 6):
            row_addresses = unique_addresses[i:i+6]
            row_text = "  ".join(f"{addr:>8}" for addr in row_addresses)
            logger.info(f"  {row_text}")
        
        logger.info("")
        logger.info("📋 COPY-PASTE FORMAT:")
        logger.info("-" * 50)
        logger.info(", ".join(unique_addresses))
        
        # Range analysis
        if unique_addresses:
            # Convert hex addresses to integers for comparison
            addr_values = [int(addr, 16) for addr in unique_addresses]
            min_addr = min(addr_values)
            max_addr = max(addr_values)
            
            logger.info("")
            logger.info("📈 RANGE ANALYSIS:")
            logger.info(f"  Lowest address:  0x{min_addr:X} ({min_addr})")
            logger.info(f"  Highest address: 0x{max_addr:X} ({max_addr})")
            logger.info(f"  Address span:    {max_addr - min_addr} bytes")
        
        logger.info("=" * 90)

def main():
    """Main execution"""
    try:
        logger.info("🚀 Starting Simple Complete Address Extraction")
        
        extractor = SimpleCompleteAddressExtractor()
        
        # Extract address data from Diablo II cheat table
        table_path = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
        address_entries = extractor.extract_address_data(table_path)
        
        # Display complete list
        extractor.display_complete_list(address_entries)
        
        logger.info("✅ Extraction completed successfully!")
        return 0
        
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
