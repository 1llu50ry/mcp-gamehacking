#!/usr/bin/env python3
"""
Enhanced Complete Address List Extractor
Displays complete address list from Diablo II.CT with enhanced descriptions
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

class EnhancedCompleteAddressExtractor:
    """Enhanced utility to extract complete address list with better descriptions"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            from cheatengine.table_parser import CheatTableParser
            self.table_parser = CheatTableParser()
            logger.info("✅ Enhanced Address Extractor initialized")
        except ImportError as e:
            logger.error(f"❌ Failed to import parser: {e}")
            raise
        
        # Enhanced description mapping for common game addresses
        self.description_mapping = {
            0x4: "player_pointer",
            0x8: "health_base", 
            0xC: "mana_base",
            0x10: "experience_points",
            0x14: "character_level",
            0x18: "strength_stat",
            0x1C: "dexterity_stat",
            0x20: "vitality_stat",
            0x24: "energy_stat",
            0x28: "life_current",
            0x2C: "life_maximum",
            0x30: "mana_current",
            0x44: "stamina_current",
            0x48: "stamina_maximum",
            0x4C: "character_class",
            0x4E: "character_name",
            0x50: "inventory_gold",
            0x54: "stash_gold",
            0x58: "current_act",
            0x5C: "difficulty_level",
            0x60: "quest_flags",
            0x64: "waypoint_flags",
            0x68: "skill_points",
            0x8C: "monster_hp_1",
            0x8E: "monster_hp_2",
            0x90: "monster_hp_3",
            0x94: "item_quality",
            0x98: "item_durability",
            0x9C: "mercenary_hp",
            0xA4: "fire_resistance",
            0xA8: "cold_resistance",
            0xAC: "lightning_resistance",
            0xC4: "poison_resistance",
            0xC8: "magic_find",
            0xCC: "gold_find",
            0xE0: "attack_rating",
            0xE4: "defense_rating",
            0xE8: "faster_hit_recovery",
            0xEC: "faster_cast_rate"
        }

    def extract_address_data(self, table_path: str) -> List[dict]:
        """Extract complete address data from cheat table with enhanced descriptions"""
        try:
            logger.info(f"📁 Loading: {table_path}")
            
            # Parse cheat table
            cheat_table = self.table_parser.parse_file(table_path)
            if not cheat_table:
                logger.error("❌ Failed to parse cheat table")
                return []
            
            # Extract address entries with enhanced details
            address_entries = []
            for entry in cheat_table.entries:
                if entry.address and not entry.group_header:
                    # Enhanced description based on address
                    enhanced_desc = self.description_mapping.get(entry.address, entry.description or "unknown_value")
                    
                    # Format address with module if available (simulate D2GAME.dll)
                    if entry.address in self.description_mapping:
                        address_str = f"D2GAME.dll+{entry.address:X}"
                    else:
                        address_str = f"0x{entry.address:X}"
                    
                    address_info = {
                        'address': address_str,
                        'address_hex': f"0x{entry.address:X}",
                        'address_decimal': entry.address,
                        'type': entry.variable_type or "4 Bytes",
                        'description': enhanced_desc,
                        'enabled': entry.enabled,
                        'original_description': entry.description or "Address from binary table"
                    }
                    address_entries.append(address_info)
            
            return address_entries
            
        except Exception as e:
            logger.error(f"❌ Error extracting addresses: {e}")
            return []

    def display_complete_list(self, address_entries: List[dict]):
        """Display the complete address list in enhanced format"""
        logger.info("=" * 100)
        logger.info("📍 COMPLETE ADDRESS LIST FROM DIABLO II.CT (Enhanced)")
        logger.info("=" * 100)
        
        if not address_entries:
            logger.info("❌ No addresses found")
            return
        
        logger.info(f"📊 Total addressable entries: {len(address_entries)}")
        logger.info("")
        
        # Display header in the exact format requested
        print(f"{'#':<4} {'ADDRESS':<25} {'TYPE':<15} {'ENABLED':<8} {'DESCRIPTION'}")
        print("-" * 100)
        
        # Display each entry with enhanced descriptions
        for i, entry in enumerate(address_entries, 1):
            enabled_status = "Yes" if entry['enabled'] else "No"
            description = entry['description'][:40] + "..." if len(entry['description']) > 40 else entry['description']
            
            print(f"{i:<4} {entry['address']:<25} {entry['type']:<15} {enabled_status:<8} {description}")
        
        # Summary section
        logger.info("")
        logger.info("=" * 100)
        logger.info("📊 SUMMARY")
        logger.info("=" * 100)
        
        # Get unique addresses for summary
        unique_addresses = []
        seen_addresses = set()
        for entry in address_entries:
            if entry['address_decimal'] not in seen_addresses:
                unique_addresses.append(entry['address_hex'])
                seen_addresses.add(entry['address_decimal'])
        
        logger.info(f"Total entries: {len(address_entries)}")
        logger.info(f"Unique addresses: {len(unique_addresses)}")
        
        # Display categories
        logger.info("")
        logger.info("🎯 ADDRESS CATEGORIES:")
        logger.info("-" * 60)
        
        categories = {
            'Character Stats': ['strength_stat', 'dexterity_stat', 'vitality_stat', 'energy_stat'],
            'Health & Mana': ['health_base', 'mana_base', 'life_current', 'life_maximum', 'mana_current'],
            'Character Info': ['character_level', 'character_class', 'character_name', 'experience_points'],
            'Resistances': ['fire_resistance', 'cold_resistance', 'lightning_resistance', 'poison_resistance'],
            'Game Progress': ['current_act', 'difficulty_level', 'quest_flags', 'waypoint_flags'],
            'Items & Gold': ['inventory_gold', 'stash_gold', 'magic_find', 'gold_find']
        }
        
        for category, desc_list in categories.items():
            found_entries = [e for e in address_entries if e['description'] in desc_list]
            if found_entries:
                logger.info(f"  {category}: {len(found_entries)} entries")
        
        # Display unique addresses
        logger.info("")
        logger.info("📋 ALL UNIQUE ADDRESSES:")
        logger.info("-" * 60)
        
        # Show addresses in rows of 6
        for i in range(0, len(unique_addresses), 6):
            row_addresses = unique_addresses[i:i+6]
            row_text = "  ".join(f"{addr:>8}" for addr in row_addresses)
            logger.info(f"  {row_text}")
        
        logger.info("")
        logger.info("📄 COPY-PASTE FORMAT:")
        logger.info("-" * 60)
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
            logger.info(f"  Average offset:  {(max_addr - min_addr) // len(addr_values)} bytes")
        
        logger.info("=" * 100)

    def export_enhanced_csv(self, address_entries: List[dict], output_path: str):
        """Export enhanced address data to CSV"""
        try:
            import csv
            
            with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
                fieldnames = ['index', 'address', 'address_hex', 'type', 'enhanced_description', 'original_description', 'enabled']
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                
                writer.writeheader()
                for i, entry in enumerate(address_entries, 1):
                    csv_entry = {
                        'index': i,
                        'address': entry['address'],
                        'address_hex': entry['address_hex'],
                        'type': entry['type'],
                        'enhanced_description': entry['description'],
                        'original_description': entry['original_description'],
                        'enabled': 'Yes' if entry['enabled'] else 'No'
                    }
                    writer.writerow(csv_entry)
            
            logger.info(f"✅ Enhanced CSV export completed: {output_path}")
            
        except Exception as e:
            logger.error(f"❌ Error exporting enhanced CSV: {e}")

def main():
    """Main execution"""
    try:
        logger.info("🚀 Starting Enhanced Complete Address Extraction")
        
        extractor = EnhancedCompleteAddressExtractor()
        
        # Extract address data from Diablo II cheat table
        table_path = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
        address_entries = extractor.extract_address_data(table_path)
        
        # Display enhanced complete list
        extractor.display_complete_list(address_entries)
        
        # Export enhanced CSV
        exports_dir = Path("exports")
        exports_dir.mkdir(exist_ok=True)
        csv_path = exports_dir / "diablo_ii_enhanced_addresses.csv"
        extractor.export_enhanced_csv(address_entries, str(csv_path))
        
        logger.info(f"📄 Enhanced CSV exported: {csv_path}")
        logger.info("✅ Enhanced extraction completed successfully!")
        return 0
        
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
