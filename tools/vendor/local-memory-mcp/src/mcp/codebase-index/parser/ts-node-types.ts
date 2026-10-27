/**
 * Shared tree-sitter-typescript grammar node-type constants.
 *
 * Centralizes the node type strings used by the TypeScriptVisitor and its
 * sibling helper modules (export scanner, signature builder, doc-comment
 * extraction, reference emission) so every module reads the grammar surface
 * it handles from a single source of truth (TASK-267 split).
 */

// ── Top-level declaration / body node types ──────────────────────────

export const FUNCTION_DECLARATION = "function_declaration";
export const GENERATOR_FUNCTION_DECLARATION = "generator_function_declaration";
export const METHOD_DEFINITION = "method_definition";
export const CLASS_DECLARATION = "class_declaration";
export const ABSTRACT_CLASS_DECLARATION = "abstract_class_declaration";
export const CLASS_BODY = "class_body";
export const INTERFACE_DECLARATION = "interface_declaration";
export const INTERFACE_BODY = "interface_body";
export const TYPE_ALIAS_DECLARATION = "type_alias_declaration";
export const ENUM_DECLARATION = "enum_declaration";
export const ENUM_BODY = "enum_body";
export const VARIABLE_DECLARATION = "variable_declaration";
export const LEXICAL_DECLARATION = "lexical_declaration";
export const ARROW_FUNCTION = "arrow_function";
export const EXPORT_STATEMENT = "export_statement";
export const NAMED_EXPORTS = "export_clause";
export const EXPORT_SPECIFIER = "export_specifier";
export const COMMENT = "comment";

// TS-specific member / type nodes.
export const PROPERTY_SIGNATURE = "property_signature";
export const METHOD_SIGNATURE = "method_signature";
export const ABSTRACT_METHOD_SIGNATURE = "abstract_method_signature";
export const INDEX_SIGNATURE = "index_signature";
export const ENUM_ASSIGNMENT = "enum_assignment";
export const PUBLIC_FIELD_DEFINITION = "public_field_definition";
export const FIELD_DEFINITION = "field_definition";
export const PROPERTY_IDENTIFIER = "property_identifier";
export const DECORATOR = "decorator";

// Call-site / import node types (reference emission, TASK-236 / issue #64).
export const CALL_EXPRESSION = "call_expression";
export const NEW_EXPRESSION = "new_expression";
export const MEMBER_EXPRESSION = "member_expression";
export const IMPORT_STATEMENT = "import_statement";
export const IMPORT_CLAUSE = "import_clause";
export const NAMED_IMPORTS = "named_imports";
export const IMPORT_SPECIFIER = "import_specifier";
export const NAMESPACE_IMPORT = "namespace_import";
export const STRING = "string";

// Heritage / type-reference node types (reference emission, TASK-301).
export const CLASS_HERITAGE = "class_heritage";
export const EXTENDS_CLAUSE = "extends_clause";
export const IMPLEMENTS_CLAUSE = "implements_clause";
export const EXTENDS_TYPE_CLAUSE = "extends_type_clause";
export const TYPE_IDENTIFIER = "type_identifier";
export const NESTED_TYPE_IDENTIFIER = "nested_type_identifier";
export const GENERIC_TYPE = "generic_type";
export const TYPE_PARAMETER = "type_parameter";
export const TYPE_PARAMETERS = "type_parameters";
export const CONSTRAINT = "constraint";

// Type-annotation / structural type node types (type-reference emission,
// TASK-008 / issue #82).
export const TYPE_ANNOTATION = "type_annotation";
export const UNION_TYPE = "union_type";
export const INTERSECTION_TYPE = "intersection_type";
export const ARRAY_TYPE = "array_type";
export const PAREN_TYPE = "parenthesized_type";
export const REQUIRED_PARAMETER = "required_parameter";
export const OPTIONAL_PARAMETER = "optional_parameter";
export const FORMAL_PARAMETERS = "formal_parameters";
export const FUNCTION_SIGNATURE = "function_signature";
