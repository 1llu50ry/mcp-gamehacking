#!/usr/bin/env python3
"""
Complete Address List Exporter
Exports the complete address list from Diablo II.CT in multiple formats
"""

import logging
import sys
import os
import csv
from pathlib import Path
from typing import List, Dict

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CompleteAddressListExporter:
    """Export complete address list in multiple formats"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            from cheatengine.table_parser import CheatTableParser
            self.table_parser = CheatTableParser()
            logger.info("✅ Address List Exporter initialized")
        except ImportError as e:
            logger.error(f"❌ Failed to import parser: {e}")
            raise

    def extract_address_data(self, cheat_table_path: str) -> List[Dict]:
        """Extract address data as structured list"""
        try:
            logger.info(f"📋 Loading cheat table: {cheat_table_path}")
            
            # Parse cheat table
            cheat_table = self.table_parser.parse_file(cheat_table_path)
            if not cheat_table:
                logger.error("❌ Failed to parse cheat table")
                return []
            
            # Extract addressable entries
            address_data = []
            address_entries = [e for e in cheat_table.entries if e.address and not e.group_header]
            
            for i, entry in enumerate(address_entries, 1):
                address_info = {
                    'index': i,
                    'address_hex': f"0x{entry.address:X}",
                    'address_decimal': entry.address,
                    'type': entry.variable_type or "4 Bytes",
                    'description': entry.description or f"Entry_{i}",
                    'enabled': entry.enabled,
                    'value': entry.value,
                    'offsets': entry.offsets or [],
                    'hotkey': entry.hotkey or ""
                }
                address_data.append(address_info)
            
            return address_data
            
        except Exception as e:
            logger.error(f"❌ Error extracting address data: {e}")
            return []

    def display_formatted_list(self, address_data: List[Dict]):
        """Display complete formatted address list"""
        if not address_data:
            print("❌ No address data available")
            return
        
        print("\n" + "="*100)
        print("📍 COMPLETE ADDRESS LIST FROM DIABLO II.CT")
        print("="*100)
        print(f"📊 Total Addressable Entries: {len(address_data)}")
        print("="*100)
        
        # Header
        print(f"{'#':<4} {'ADDRESS':<12} {'TYPE':<15} {'ENABLED':<8} {'DESCRIPTION':<40}")
        print("-" * 100)
        
        # Data rows
        for entry in address_data:
            enabled_status = "✅ YES" if entry['enabled'] else "⭕ NO"
            description = entry['description'][:37] + "..." if len(entry['description']) > 37 else entry['description']
            
            print(f"{entry['index']:<4} {entry['address_hex']:<12} {entry['type']:<15} {enabled_status:<8} {description:<40}")
        
        # Unique addresses summary
        unique_addresses = sorted(list(set(entry['address_decimal'] for entry in address_data)))
        
        print("\n" + "="*100)
        print("📊 UNIQUE ADDRESSES SUMMARY")
        print("="*100)
        print(f"Total entries: {len(address_data)}")
        print(f"Unique addresses: {len(unique_addresses)}")
        
        # Display unique addresses in hex
        print(f"\n🎯 ALL UNIQUE ADDRESSES ({len(unique_addresses)} total):")
        print("-" * 60)
        hex_addresses = [f"0x{addr:X}" for addr in unique_addresses]
        
        # Display in rows of 8 for better readability
        for i in range(0, len(hex_addresses), 8):
            row_addresses = hex_addresses[i:i+8]
            print("  " + "  ".join(f"{addr:>6}" for addr in row_addresses))
        
        # Copy-paste format
        print(f"\n📋 COPY-PASTE FORMAT:")
        print("-" * 60)
        print(", ".join(hex_addresses))
        
        # Range analysis
        if unique_addresses:
            min_addr = min(unique_addresses)
            max_addr = max(unique_addresses)
            print(f"\n📈 ADDRESS RANGE ANALYSIS:")
            print(f"  Lowest address:  0x{min_addr:X} ({min_addr} decimal)")
            print(f"  Highest address: 0x{max_addr:X} ({max_addr} decimal)")
            print(f"  Address span:    {max_addr - min_addr} bytes")
            print(f"  Data type:       {address_data[0]['type']} (consistent across all entries)")
        
        print("="*100)

    def export_to_csv(self, address_data: List[Dict], output_path: str):
        """Export address data to CSV file"""
        try:
            with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
                fieldnames = ['index', 'address_hex', 'address_decimal', 'type', 'description', 'enabled', 'value', 'hotkey']
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                
                writer.writeheader()
                for entry in address_data:
                    # Clean up data for CSV
                    csv_entry = {
                        'index': entry['index'],
                        'address_hex': entry['address_hex'],
                        'address_decimal': entry['address_decimal'],
                        'type': entry['type'],
                        'description': entry['description'],
                        'enabled': 'Yes' if entry['enabled'] else 'No',
                        'value': entry['value'] if entry['value'] is not None else '',
                        'hotkey': entry['hotkey']
                    }
                    writer.writerow(csv_entry)
            
            logger.info(f"✅ CSV export completed: {output_path}")
            
        except Exception as e:
            logger.error(f"❌ Error exporting to CSV: {e}")

    def export_to_text(self, address_data: List[Dict], output_path: str):
        """Export address data to formatted text file"""
        try:
            with open(output_path, 'w', encoding='utf-8') as txtfile:
                txtfile.write("COMPLETE ADDRESS LIST FROM DIABLO II.CT\n")
                txtfile.write("=" * 80 + "\n")
                txtfile.write(f"Generated from: Diablo II.CT\n")
                txtfile.write(f"Total entries: {len(address_data)}\n")
                txtfile.write("=" * 80 + "\n\n")
                
                txtfile.write(f"{'#':<4} {'ADDRESS':<12} {'TYPE':<15} {'ENABLED':<8} {'DESCRIPTION'}\n")
                txtfile.write("-" * 80 + "\n")
                
                for entry in address_data:
                    enabled_status = "Yes" if entry['enabled'] else "No"
                    txtfile.write(f"{entry['index']:<4} {entry['address_hex']:<12} {entry['type']:<15} {enabled_status:<8} {entry['description']}\n")
                
                # Add unique addresses section
                unique_addresses = sorted(list(set(entry['address_decimal'] for entry in address_data)))
                hex_addresses = [f"0x{addr:X}" for addr in unique_addresses]
                
                txtfile.write("\n" + "=" * 80 + "\n")
                txtfile.write("UNIQUE ADDRESSES\n")
                txtfile.write("=" * 80 + "\n")
                txtfile.write(", ".join(hex_addresses) + "\n")
            
            logger.info(f"✅ Text export completed: {output_path}")
            
        except Exception as e:
            logger.error(f"❌ Error exporting to text: {e}")

def main():
    """Main execution"""
    try:
        print("📊 Complete Address List Exporter for Diablo II.CT")
        print("=" * 60)
        
        exporter = CompleteAddressListExporter()
        
        # Extract address data
        table_path = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
        address_data = exporter.extract_address_data(table_path)
        
        if not address_data:
            print("❌ No address data found")
            return 1
        
        # Display formatted list
        exporter.display_formatted_list(address_data)
        
        # Export options
        print("\n📁 EXPORT OPTIONS:")
        print("-" * 30)
        
        # Create exports directory
        exports_dir = Path("exports")
        exports_dir.mkdir(exist_ok=True)
        
        # Export to CSV
        csv_path = exports_dir / "diablo_ii_addresses.csv"
        exporter.export_to_csv(address_data, str(csv_path))
        
        # Export to text
        txt_path = exports_dir / "diablo_ii_addresses.txt"
        exporter.export_to_text(address_data, str(txt_path))
        
        print(f"📄 CSV file: {csv_path}")
        print(f"📄 Text file: {txt_path}")
        print("\n✅ Complete address list export finished!")
        
        return 0
        
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
