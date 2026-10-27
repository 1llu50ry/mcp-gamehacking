#!/usr/bin/env python3
"""
D2 Manual Review Workflow
Interactive tool for reviewing and correcting function name propagation
"""

import subprocess
import json
import os
from typing import Dict, List, Optional
from dataclasses import dataclass
import argparse


@dataclass
class ReviewCandidate:
    source_name: str
    target_name: str
    target_id: int
    similarity_score: float
    confidence: str
    match_reason: str
    target_addr: int


class D2ReviewWorkflow:
    def __init__(self, db_container="bsim-postgres"):
        self.db_container = db_container
        self.reviewed_functions = {}
        self.corrections_applied = []

    def exec_sql(self, query: str) -> List[List[str]]:
        """Execute SQL query and return results"""
        cmd = ['docker', 'exec', self.db_container, 'psql', '-U', 'ben', '-d', 'bsim', '-t', '-c', query]
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"SQL Error: {result.stderr}")
            return []

        lines = [line.strip() for line in result.stdout.split('\n') if line.strip()]
        return [line.split('|') for line in lines if '|' in line]

    def get_review_candidates(self, source_version: str, target_version: str,
                            max_candidates: int = 20) -> List[ReviewCandidate]:
        """Get functions that need manual review"""
        query = f"""
        SELECT
            source_func_name, target_func_name, target_func_id,
            similarity_score, confidence_level, match_reason,
            (SELECT addr FROM function WHERE id = target_func_id)
        FROM find_d2_function_patterns('{source_version}', '{target_version}', 0.5)
        WHERE confidence_level IN ('LOW', 'VERY_LOW')
        ORDER BY similarity_score DESC
        LIMIT {max_candidates};
        """

        results = self.exec_sql(query)
        candidates = []

        for row in results:
            if len(row) >= 6:
                candidates.append(ReviewCandidate(
                    source_name=row[0].strip(),
                    target_name=row[1].strip(),
                    target_id=int(row[2].strip()),
                    similarity_score=float(row[3].strip()),
                    confidence=row[4].strip(),
                    match_reason=row[5].strip(),
                    target_addr=int(row[6].strip()) if row[6].strip().isdigit() else 0
                ))

        return candidates

    def display_candidate_info(self, candidate: ReviewCandidate, index: int, total: int):
        """Display detailed information about a candidate"""
        print(f"\n{'='*60}")
        print(f"Review Candidate {index + 1}/{total}")
        print(f"{'='*60}")
        print(f"Source Function: {candidate.source_name}")
        print(f"Target Function: {candidate.target_name}")
        print(f"Target Address:  0x{candidate.target_addr:08x}")
        print(f"Similarity:      {candidate.similarity_score:.3f} ({candidate.confidence})")
        print(f"Match Reason:    {candidate.match_reason}")

        # Show function context if available
        self._show_function_context(candidate)

    def _show_function_context(self, candidate: ReviewCandidate):
        """Show additional context about the function"""
        # Get function signature information
        sig_query = f"""
        SELECT significance, vector_count
        FROM signature
        WHERE function_id = {candidate.target_id}
        LIMIT 1;
        """

        sig_results = self.exec_sql(sig_query)
        if sig_results:
            significance = float(sig_results[0][0].strip())
            vector_count = int(sig_results[0][1].strip())
            print(f"Signature Info:  Significance={significance:.3f}, Vectors={vector_count}")

        # Check for similar named functions
        similar_query = f"""
        SELECT name_func, addr
        FROM function f
        JOIN executable e ON f.executable_id = e.id
        WHERE f.name_func LIKE '%{candidate.source_name.split('_')[0]}%'
        AND e.name_exec LIKE '%diablo2%'
        AND f.id != {candidate.target_id}
        LIMIT 3;
        """

        similar_results = self.exec_sql(similar_query)
        if similar_results:
            print("Similar Functions:")
            for row in similar_results:
                if len(row) >= 2:
                    name = row[0].strip()
                    addr = int(row[1].strip()) if row[1].strip().isdigit() else 0
                    print(f"  - {name} @ 0x{addr:08x}")

    def review_candidate(self, candidate: ReviewCandidate) -> str:
        """Interactive review of a single candidate"""
        while True:
            print(f"\nReview Options:")
            print(f"  [a] Accept - Apply '{candidate.source_name}'")
            print(f"  [r] Reject - Keep '{candidate.target_name}'")
            print(f"  [c] Custom - Enter custom name")
            print(f"  [s] Skip - Review later")
            print(f"  [i] Info - Show more details")
            print(f"  [q] Quit - Exit review")

            choice = input(f"\nChoice [a/r/c/s/i/q]: ").lower().strip()

            if choice == 'a':
                return 'ACCEPT'
            elif choice == 'r':
                return 'REJECT'
            elif choice == 'c':
                custom_name = input("Enter custom function name: ").strip()
                if custom_name and self._validate_function_name(custom_name):
                    candidate.source_name = custom_name  # Update for application
                    return 'CUSTOM'
                else:
                    print("Invalid function name. Use format: category_ActionObject")
            elif choice == 's':
                return 'SKIP'
            elif choice == 'i':
                self._show_function_context(candidate)
                continue
            elif choice == 'q':
                return 'QUIT'
            else:
                print("Invalid choice. Please try again.")

    def _validate_function_name(self, name: str) -> bool:
        """Basic validation for function names"""
        if not name:
            return False
        if any(char in name for char in [' ', '\t', '\n', ';', '"', "'"]):
            return False
        if name.startswith('FUN_'):
            return False
        return True

    def apply_correction(self, candidate: ReviewCandidate, action: str) -> bool:
        """Apply the review decision"""
        if action == 'ACCEPT' or action == 'CUSTOM':
            update_query = f"""
            UPDATE function
            SET name_func = '{candidate.source_name}'
            WHERE id = {candidate.target_id};
            """

            result = self.exec_sql(update_query)
            if result is not None:  # Success (even if empty result)
                self.corrections_applied.append({
                    'target_id': candidate.target_id,
                    'old_name': candidate.target_name,
                    'new_name': candidate.source_name,
                    'action': action
                })
                print(f"✓ Applied: {candidate.target_name} -> {candidate.source_name}")
                return True
            else:
                print(f"✗ Failed to update {candidate.target_name}")
                return False
        elif action == 'REJECT':
            print(f"✓ Rejected: Keeping {candidate.target_name}")
            return True

        return False

    def save_review_session(self, filename: str):
        """Save review session results"""
        session_data = {
            'reviewed_count': len(self.reviewed_functions),
            'corrections_applied': self.corrections_applied,
            'session_summary': {
                'accepted': len([c for c in self.corrections_applied if c['action'] in ['ACCEPT', 'CUSTOM']]),
                'rejected': len(self.reviewed_functions) - len(self.corrections_applied)
            }
        }

        with open(filename, 'w') as f:
            json.dump(session_data, f, indent=2)

        print(f"Review session saved to {filename}")

    def run_review_session(self, source_version: str, target_version: str,
                          max_reviews: int = 10) -> Dict:
        """Run interactive review session"""
        print(f"Starting review session: {source_version} -> {target_version}")
        print(f"Maximum reviews: {max_reviews}")

        candidates = self.get_review_candidates(source_version, target_version, max_reviews)

        if not candidates:
            print("No candidates need review!")
            return {'reviewed': 0, 'applied': 0}

        print(f"Found {len(candidates)} candidates for review")

        reviewed_count = 0
        applied_count = 0

        for i, candidate in enumerate(candidates):
            self.display_candidate_info(candidate, i, len(candidates))

            action = self.review_candidate(candidate)

            if action == 'QUIT':
                print("Review session terminated by user")
                break
            elif action == 'SKIP':
                print("Skipped for later review")
                continue

            self.reviewed_functions[candidate.target_id] = action
            reviewed_count += 1

            if action in ['ACCEPT', 'CUSTOM']:
                if self.apply_correction(candidate, action):
                    applied_count += 1
            elif action == 'REJECT':
                pass  # Just mark as reviewed

        # Session summary
        print(f"\n{'='*60}")
        print(f"Review Session Complete")
        print(f"{'='*60}")
        print(f"Candidates Reviewed: {reviewed_count}")
        print(f"Corrections Applied: {applied_count}")
        print(f"Functions Rejected:  {reviewed_count - applied_count}")

        return {
            'reviewed': reviewed_count,
            'applied': applied_count,
            'candidates': len(candidates)
        }


def main():
    parser = argparse.ArgumentParser(description='D2 Manual Review Workflow')
    parser.add_argument('--source', required=True, help='Source version')
    parser.add_argument('--target', required=True, help='Target version')
    parser.add_argument('--max-reviews', type=int, default=10, help='Maximum reviews per session')
    parser.add_argument('--save-session', help='Save session results to file')

    args = parser.parse_args()

    workflow = D2ReviewWorkflow()

    try:
        results = workflow.run_review_session(
            args.source,
            args.target,
            args.max_reviews
        )

        if args.save_session:
            workflow.save_review_session(args.save_session)

        print(f"\nFinal Results: {results}")

    except KeyboardInterrupt:
        print("\nReview interrupted by user")
    except Exception as e:
        print(f"Error during review: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())