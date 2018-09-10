import { parse as parseAST, Property, Term } from "./ast";
import { emptyOptional, forceUnwrapFailed, newScopeWithBuiltins, optionalIsSome, unwrapOptional, wrapInOptional } from "./builtins";
import { Declaration, parse as parseDeclaration } from "./declaration";
import { FunctionBuilder, insertFunction, noinline, returnType, wrapped } from "./functions";
import { defaultInstantiateType, EnumCase, expressionSkipsCopy, field, Field, FunctionMap, newClass, PossibleRepresentation, ReifiedType, reifyType, storeValue, struct } from "./reified";
import { addExternalVariable, addVariable, emitScope, lookup, mangleName, newScope, rootScope, Scope, undefinedLiteral, uniqueIdentifier } from "./scope";
import { Function, parse as parseType, Type } from "./types";
import { concat, expectLength } from "./utils";
import { ArgGetter, boxed, call, callable, copy, expr, ExpressionValue, functionValue, FunctionValue, hoistToIdentifier, isNestedOptional, isPure, literal, newPointer, read, reuseExpression, set, statements, stringifyType, subscript, tuple, TupleValue, unbox, undefinedValue, Value, valueOfExpression, variable, VariableValue } from "./values";

import { transformFromAst } from "babel-core";
import { ArrayExpression, arrayExpression, assignmentExpression, binaryExpression, blockStatement, booleanLiteral, callExpression, catchClause, classBody, classDeclaration, conditionalExpression, exportNamedDeclaration, exportSpecifier, Expression, expressionStatement, functionDeclaration, functionExpression, identifier, Identifier, IfStatement, ifStatement, isBooleanLiteral, isIdentifier, isStringLiteral, logicalExpression, LVal, MemberExpression, memberExpression, newExpression, numericLiteral, objectExpression, objectProperty, ObjectProperty, program, Program, returnStatement, ReturnStatement, sequenceExpression, Statement, stringLiteral, switchCase, SwitchCase, switchStatement, thisExpression, ThisExpression, throwStatement, tryStatement, unaryExpression, variableDeclaration, variableDeclarator, whileStatement } from "babel-types";
import { spawn } from "child_process";
import { readdirSync } from "fs";
import { argv } from "process";

const hasOwnProperty = Object.hasOwnProperty.call.bind(Object.hasOwnProperty);

function getField(value: Value, field: Field, scope: Scope) {
	if (field.stored) {
		return expr(memberExpression(read(value, scope), mangleName(field.name)));
	} else {
		return field.getter(value, scope);
	}
}

const emptyStatements: Statement[] = [];

function termsWithName(terms: Term[], name: string): Term[] {
	return terms.filter((term) => term.name === name);
}

function findTermWithName(terms: Term[], name: string | RegExp): Term | undefined {
	if (typeof name === "string") {
		for (const term of terms) {
			if (term.name === name) {
				return term;
			}
		}
	} else {
		for (const term of terms) {
			if (name.test(term.name)) {
				return term;
			}
		}
	}
	return undefined;
}

function termWithName(terms: Term[], name: string | RegExp): Term {
	const result = findTermWithName(terms, name);
	if (typeof result === "undefined") {
		throw new Error(`Could not find ${name} term: ${terms.map((term) => term.name).join(", ")}`);
	}
	return result;
}

function checkTermName(term: Term, expectedName: string, errorPrefix?: string) {
	if (term.name !== expectedName) {
		throw new TypeError(`Expected a ${expectedName}${typeof errorPrefix !== "undefined" ? " " + errorPrefix : ""}, got a ${term.name}`);
	}
}

function isString(value: any): value is string {
	return typeof value === "string";
}

function getProperty<T extends Property>(term: Term, key: string, checker: (prop: Property) => prop is T): T {
	const props = term.properties;
	if (hasOwnProperty(props, key)) {
		const value = props[key];
		if (checker(value)) {
			return value;
		}
		throw new Error(`Value for ${key} on ${term.name} is of the wrong type: ${JSON.stringify(term.properties)}`);
	}
	throw new Error(`Could not find ${key} in ${term.name}. Keys are ${Object.keys(props).join(", ")}`);
}

function constructTypeFromNames(baseType: string, typeParameters?: ReadonlyArray<string>): Type {
	if (typeof typeParameters === "undefined") {
		return parseType(baseType);
	}
	switch (baseType) {
		case "Optional":
			if (typeParameters.length < 1) {
				throw new TypeError(`Expected at least one type parameter for Optional`);
			}
			return { kind: "optional", type: parseType(typeParameters[0]) };
		case "Tuple":
			return { kind: "tuple", types: typeParameters.map((type) => parseType(type)) };
		case "Array":
			if (typeParameters.length < 1) {
				throw new TypeError(`Expected at least one type parameter for Array`);
			}
			return { kind: "array", type: parseType(typeParameters[0]) };
		case "Dictionary":
			if (typeParameters.length < 2) {
				throw new TypeError(`Expected at least two type parameters for Dictionary`);
			}
			return { kind: "dictionary", keyType: parseType(typeParameters[0]), valueType: parseType(typeParameters[1]) };
		default:
			return { kind: "generic", base: parseType(baseType), arguments: typeParameters.map((type) => parseType(type)) };
	}
}

function extractReference(term: Term, scope: Scope, type?: Function): Value {
	const decl = getProperty(term, "decl", isString);
	const declaration = parseDeclaration(decl);
	if (typeof declaration.local === "string") {
		if (declaration.local === "$match") {
			return variable(identifier("$match"));
		}
		return variable(lookup(declaration.local, scope));
	}
	if (typeof declaration.member === "string") {
		const functionType = typeof declaration.type === "string" ? reifyType(constructTypeFromNames(declaration.type, declaration.substitutions), scope) : undefined;
		if (Object.hasOwnProperty.call(functionType !== undefined ? functionType.functions : scope.functions, declaration.member)) {
			return functionValue(declaration.member, functionType, type || getFunctionType(term));
		}
		return variable(lookup(declaration.member, scope));
	}
	throw new TypeError(`Unable to parse and locate declaration: ${decl} (got ${JSON.stringify(declaration)})`);
}

function getType(term: Term) {
	try {
		return parseType(getProperty(term, "type", isString));
	} catch (e) {
		console.log(term);
		throw e;
	}
}

function getFunctionType(term: Term) {
	const result = getType(term);
	if (result.kind !== "function") {
		throw new TypeError(`Expected a function, got ${stringifyType(result)}`);
	}
	return result;
}

function collapseToExpression(expressions: Expression[]): Expression {
	return expressions.length === 0 ? undefinedLiteral : expressions.length === 1 ? expressions[0] : sequenceExpression(expressions);
}

function noSemanticExpressions(term: Term) {
	return term.name !== "semantic_expr";
}

function requiresGetter(term: Term): boolean {
	if (Object.hasOwnProperty.call(term.properties, "storage_kind")) {
		return getProperty(term, "storage_kind", isString) === "computed";
	}
	return getProperty(term, "readImpl", isString) !== "stored";
}

function returnUndef() {
	return undefined;
}

interface PatternOutput {
	prefix: Statement[];
	test: Value;
	next?: PatternOutput;
}

const trueValue = expr(literal(true));

function isTrueExpression(expression: Expression) {
	return expression.type === "BooleanLiteral" && expression.value === true;
}

const emptyPattern: PatternOutput = {
	prefix: emptyStatements,
	test: trueValue,
};

function mergePatterns(first: PatternOutput, second: PatternOutput, scope: Scope): PatternOutput {
	const prefix = concat(first.prefix, second.prefix);
	const next = first.next ? (second.next ? mergePatterns(first.next, second.next, scope) : first.next) : second.next;
	const firstExpression = read(first.test, scope);
	if (isTrueExpression(firstExpression)) {
		return {
			prefix,
			test: second.test,
			next,
		};
	}
	const secondExpression = read(second.test, scope);
	if (isTrueExpression(secondExpression)) {
		return {
			prefix,
			test: expr(firstExpression),
			next,
		};
	}
	return {
		prefix,
		test: expr(logicalExpression("&&", firstExpression, secondExpression)),
		next,
	};
}

export function convertToPattern(value: Value): PatternOutput {
	let prefix: Statement[] = emptyStatements;
	if (value.kind === "statements") {
		const returningIndex = value.statements.findIndex((statements) => statements.type === "ReturnStatement");
		if (returningIndex === value.statements.length - 1) {
			prefix = value.statements.slice(0, value.statements.length - 1);
			value = expr((value.statements[value.statements.length - 1] as ReturnStatement).argument);
		} else if (returningIndex === -1) {
			prefix = value.statements;
			value = expr(identifier("undefined"));
		}
	}
	return {
		prefix,
		test: value,
	};
}

function discriminantForPatternTerm(term: Term): string {
	for (const key of Object.keys(term.properties)) {
		if (term.properties[key] === true) {
			const match = key.match(/\.(.+?)$/);
			if (match) {
				return match[1];
			}
		}
	}
	throw new Error(`Expected to have a discriminant property!`);
}

function translatePattern(term: Term, value: Value, scope: Scope): PatternOutput {
	switch (term.name) {
		case "pattern_optional_some": // Development
		case "optional_some_element": { // Swift 4.1
			expectLength(term.children, 1);
			const type = getType(term);
			const [first, second] = reuseExpression(read(value, scope), scope);
			const assign = translatePattern(term.children[0], unwrapOptional(expr(first), type, scope), scope);
			return {
				prefix: emptyStatements,
				test: expr(optionalIsSome(second, type)),
				next: assign,
			};
		}
		case "case_label_item": {
			expectLength(term.children, 1);
			return translatePattern(term.children[0], value, scope);
		}
		case "pattern_let": {
			expectLength(term.children, 1);
			// TODO: Figure out how to avoid the copy here since it should only be necessary on var patterns
			return translatePattern(term.children[0], copy(value, getType(term)), scope);
		}
		case "pattern_var": {
			expectLength(term.children, 1);
			return translatePattern(term.children[0], copy(value, getType(term)), scope);
		}
		case "pattern_expr": {
			expectLength(term.children, 1);
			return {
				prefix: emptyStatements,
				test: translateTermToValue(term.children[0], scope),
			};
		}
		case "pattern_typed": {
			expectLength(term.children, 2);
			return translatePattern(term.children[0], value, scope);
		}
		case "pattern_named": {
			expectLength(term.children, 0);
			expectLength(term.args, 1);
			const name = mangleName(term.args[0]);
			const type = getType(term);
			if (Object.hasOwnProperty.call(scope.declarations, name)) {
				return {
					prefix: storeValue(name, value, type, scope).map((expression) => expressionStatement(expression)),
					test: trueValue,
				};
			} else {
				if (!scope.mapping[name.name]) {
					addVariable(scope, name);
				}
				const pattern = convertToPattern(value);
				return {
					prefix: pattern.prefix.concat([expressionStatement(assignmentExpression("=", name, read(pattern.test, scope)))]),
					test: trueValue,
				};
			}
		}
		case "pattern_tuple": {
			const type = getType(term);
			if (type.kind !== "tuple") {
				throw new TypeError(`Expected a tuple, got a ${stringifyType(type)}`);
			}
			if (value.kind === "tuple") {
				return term.children.reduce((existing, child, i) => {
					if (value.values.length <= i) {
						expectLength(value.values, i);
					}
					const childPattern = translatePattern(child, value.values[i], scope);
					return mergePatterns(existing, childPattern, scope);
				}, emptyPattern);
			}
			const [first, second] = reuseExpression(read(value, scope), scope);
			return term.children.reduce((existing, child, i) => {
				const childPattern = translatePattern(child, expr(memberExpression(i ? second : first, literal(i), true)), scope);
				return mergePatterns(existing, childPattern, scope);
			}, emptyPattern);
		}
		case "pattern_enum_element": {
			const type = getType(term);
			const reified = reifyType(type, scope);
			const cases = reified.cases;
			if (typeof cases === "undefined") {
				throw new TypeError(`Expected ${stringifyType(type)} to be an enum, but it didn't have any cases.`);
			}
			const discriminant = discriminantForPatternTerm(term);
			const index = cases.findIndex((possibleCase) => possibleCase.name === discriminant);
			if (index === -1) {
				throw new TypeError(`Could not find the ${discriminant} case in ${stringifyType(type)}, only found ${cases.map((enumCase) => enumCase.name).join(", ")}`);
			}
			const isDirectRepresentation = reified.possibleRepresentations !== PossibleRepresentation.Array;
			const [first, after] = reuseExpression(read(value, scope), scope);
			const discriminantExpression = isDirectRepresentation ? first : memberExpression(first, literal(0), true);
			const test = expr(binaryExpression("===", discriminantExpression, literal(index)));
			expectLength(term.children, 0, 1);
			if (term.children.length === 0) {
				return {
					prefix: emptyStatements,
					test,
				};
			}
			const child = term.children[0];
			let patternExpression: Expression;
			switch (cases[index].fieldTypes.length) {
				case 0:
					throw new Error(`Tried to use a pattern on an enum case that has no fields`);
				case 1:
					// Index 1 to account for the discriminant
					patternExpression = memberExpression(after, literal(1), true);
					// Special-case pattern matching using pattern_paren on a enum case with one field
					if (child.name === "pattern_paren") {
						return {
							prefix: emptyStatements,
							test,
							next: translatePattern(child.children[0], expr(patternExpression), scope),
						};
					}
					break;
				default:
					// Special-case pattern matching using pattern_tuple on a enum case with more than one field
					if (child.name === "pattern_tuple") {
						const next = child.children.reduce((existing, tupleChild, i) => {
							// Offset by 1 to account for the discriminant
							const childPattern = translatePattern(tupleChild, expr(memberExpression(after, literal(i + 1), true)), scope);
							return mergePatterns(existing, childPattern, scope);
						}, emptyPattern);
						return {
							prefix: emptyStatements,
							test,
							next,
						};
					}
					// Remove the discriminant
					patternExpression = callExpression(memberExpression(after, identifier("slice")), [literal(1)]);
					break;
			}
			// General case pattern matching on an enum
			return {
				prefix: emptyStatements,
				test,
				next: translatePattern(child, expr(patternExpression), scope),
			};
		}
		case "pattern_any": {
			return emptyPattern;
		}
		default: {
			console.log(term);
			return {
				prefix: emptyStatements,
				test: expr(identifier("unknown_pattern_type$" + term.name)),
			};
		}
	}
}

function valueForPattern(pattern: PatternOutput, scope: Scope): Value {
	let test: Value;
	if (typeof pattern.next !== "undefined") {
		const currentExpression = read(pattern.test, scope);
		const nextExpression = read(valueForPattern(pattern.next, scope), scope);
		test = expr(logicalExpression("&&", currentExpression, nextExpression));
	} else {
		test = pattern.test;
	}
	if (pattern.prefix.length) {
		return statements(pattern.prefix.concat([returnStatement(read(test, scope))]));
	}
	return test;
}

function flattenPattern(pattern: PatternOutput, scope: Scope): { prefix: Statement[]; test: Expression; suffix: Statement[] } {
	let prefix: Statement[] = emptyStatements;
	let test: Expression = literal(true);
	let currentPattern: PatternOutput | undefined = pattern;
	while (currentPattern) {
		prefix = concat(prefix, currentPattern.prefix);
		const currentTest = read(currentPattern.test, scope);
		currentPattern = currentPattern.next;
		if (!isTrueExpression(currentTest)) {
			test = currentTest;
			break;
		}
	}
	let suffix: Statement[] = emptyStatements;
	while (currentPattern) {
		suffix = concat(suffix, currentPattern.prefix);
		const currentTest = read(currentPattern.test, scope);
		currentPattern = currentPattern.next;
		if (!isTrueExpression(currentTest)) {
			test = logicalExpression("&&", test, read(statements(concat(suffix, [returnStatement(currentTest)])), scope));
			suffix = emptyStatements;
		}
	}
	return {
		prefix,
		test,
		suffix,
	};
}

function translateTermToValue(term: Term, scope: Scope, bindingContext?: (value: Value, optionalType: Type) => Value): Value {
	switch (term.name) {
		case "member_ref_expr": {
			expectLength(term.children, 1);
			const child = term.children[0];
			const type = getType(child);
			const decl = getProperty(term, "decl", isString);
			const { member } = parseDeclaration(decl);
			if (typeof member !== "string") {
				throw new TypeError(`Expected a member expression when parsing declaration: ${decl}`);
			}
			for (const field of reifyType(type, scope).fields) {
				if (field.name === member) {
					return getField(translateTermToValue(term.children[0], scope, bindingContext), field, scope);
				}
			}
			throw new TypeError(`Could not find ${member} in ${stringifyType(type)}`);
		}
		case "tuple_element_expr": {
			expectLength(term.children, 1);
			const child = term.children[0];
			const tupleType = getType(child);
			if (tupleType.kind !== "tuple") {
				throw new TypeError(`Expected a tuple, got a ${stringifyType(tupleType)}`);
			}
			if (tupleType.types.length === 1) {
				return translateTermToValue(child, scope, bindingContext);
			}
			return variable(memberExpression(
				read(translateTermToValue(child, scope, bindingContext), scope),
				literal(+getProperty(term, "field", isString)),
				true,
			));
		}
		case "pattern_typed": {
			expectLength(term.children, 2);
			return translateTermToValue(term.children[0], scope, bindingContext);
		}
		case "declref_expr": {
			expectLength(term.children, 0);
			return extractReference(term, scope);
		}
		case "subscript_expr": {
			expectLength(term.children, 2);
			const type = getType(term);
			const getterType: Function = {
				kind: "function",
				arguments: {
					kind: "tuple",
					types: term.children.map(getType),
					location: type.location,
				},
				return: type,
				throws: false,
				rethrows: false,
				attributes: [],
				location: type.location,
			};
			const getter = extractReference(term, scope, getterType);
			// TODO: Define the setter type
			const setterType: Function = {
				kind: "function",
				arguments: {
					kind: "tuple",
					types: term.children.map(getType),
					location: type.location,
				},
				return: type,
				throws: false,
				rethrows: false,
				attributes: [],
				location: type.location,
			};
			const setter = extractReference(term, scope, setterType);
			return subscript(getter, setter, term.children.map((child) => translateTermToValue(child, scope, bindingContext)));
		}
		case "prefix_unary_expr":
		case "call_expr":
		case "constructor_ref_call_expr":
		case "dot_syntax_call_expr":
		case "binary_expr": {
			expectLength(term.children, 2);
			const target = term.children[0];
			const args = term.children[1];
			const peekedTarget = translateTermToValue(target, scope, bindingContext);
			const type = getType(args);
			const argsValue = type.kind === "tuple" && type.types.length !== 1 ? translateTermToValue(args, scope, bindingContext) : tuple([translateTermToValue(args, scope, bindingContext)]);
			if (argsValue.kind === "tuple") {
				return call(peekedTarget, undefinedValue, argsValue.values, scope);
			} else {
				return call(expr(memberExpression(read(peekedTarget, scope), identifier("apply"))), undefinedValue, [expr(undefinedLiteral) as Value].concat(argsValue), scope);
			}
		}
		case "tuple_expr": {
			if (term.children.length === 1) {
				return translateTermToValue(term.children[0], scope, bindingContext);
			}
			return {
				kind: "tuple",
				values: term.children.map((child) => translateTermToValue(child, scope, bindingContext)),
			};
		}
		case "type_expr": {
			expectLength(term.children, 0);
			return expr(mangleName(getProperty(term, "type", isString)));
		}
		case "boolean_literal_expr": {
			expectLength(term.children, 0);
			return expr(literal(getProperty(term, "value", isString) === "true"));
		}
		case "integer_literal_expr": {
			expectLength(term.children, 0);
			return expr(literal(+getProperty(term, "value", isString)));
		}
		case "string_literal_expr": {
			expectLength(term.children, 0);
			return expr(literal(getProperty(term, "value", isString)));
		}
		case "array_expr": {
			const type = getType(term);
			if (type.kind !== "array") {
				throw new TypeError(`Expected an array type, got a ${stringifyType(type)}`);
			}
			return expr(arrayExpression(term.children.filter(noSemanticExpressions).map((child) => read(translateTermToValue(child, scope, bindingContext), scope))));
		}
		case "dictionary_expr": {
			const type = getType(term);
			if (type.kind !== "dictionary") {
				throw new TypeError(`Expected a dictionary type, got a ${stringifyType(type)}`);
			}
			reifyType(type, scope);
			const properties: ObjectProperty[] = [];
			for (const child of term.children.filter(noSemanticExpressions)) {
				checkTermName(child, "tuple_expr", "as child of a dictionary expression");
				expectLength(child.children, 2);
				const keyChild = child.children[0];
				const valueChild = child.children[1];
				properties.push(objectProperty(read(translateTermToValue(keyChild, scope, bindingContext), scope), read(translateTermToValue(valueChild, scope, bindingContext), scope), true));
			}
			return expr(objectExpression(properties));
		}
		case "paren_expr": {
			expectLength(term.children, 1);
			return translateTermToValue(term.children[0], scope, bindingContext);
		}
		case "if_expr": {
			expectLength(term.children, 3);
			return expr(conditionalExpression(
				read(translateTermToValue(term.children[0], scope, bindingContext), scope),
				read(translateTermToValue(term.children[1], scope, bindingContext), scope),
				read(translateTermToValue(term.children[2], scope, bindingContext), scope),
			));
		}
		case "inject_into_optional": {
			expectLength(term.children, 1);
			return wrapInOptional(translateTermToValue(term.children[0], scope, bindingContext), getType(term), scope);
		}
		case "function_conversion_expr": {
			expectLength(term.children, 1);
			return translateTermToValue(term.children[0], scope, bindingContext);
		}
		case "load_expr": {
			expectLength(term.children, 1);
			return unbox(translateTermToValue(term.children[0], scope, bindingContext), scope);
		}
		case "assign_expr": {
			expectLength(term.children, 2);
			const type = getType(term.children[0]);
			const dest = translateTermToValue(term.children[0], scope, bindingContext);
			const source = translateTermToValue(term.children[1], scope, bindingContext);
			return set(dest, source, scope);
		}
		case "inout_expr": {
			expectLength(term.children, 1);
			return boxed(translateTermToValue(term.children[0], scope, bindingContext));
		}
		case "pattern": {
			expectLength(term.children, 2);
			return valueForPattern(translatePattern(term.children[0], translateTermToValue(term.children[1], scope, bindingContext), scope), scope);
		}
		case "closure_expr":
		case "autoclosure_expr": {
			expectLength(term.children, 2);
			const parameterList = termWithName(term.children, "parameter_list");
			return callable((innerScope, arg) => {
				const childScope = newScope("anonymous", innerScope);
				termsWithName(parameterList.children, "parameter").forEach((param, index) => {
					const name = param.args[0];
					childScope.mapping[name] = hoistToIdentifier(read(arg(index, name), childScope), childScope, name);
				});
				return translateTermToValue(term.children[1], childScope, bindingContext);
			}, getType(term));
		}
		case "tuple_shuffle_expr": {
			const elements = getProperty(term, "elements", Array.isArray);
			const variadicSources = getProperty(term, "variadic_sources", Array.isArray).slice();
			const type = getType(term);
			if (type.kind !== "tuple") {
				throw new Error(`Expected a tuple type, got ${stringifyType(type)}`);
			}
			const values = term.children.map((childTerm) => translateTermToValue(childTerm, scope, bindingContext));
			const valueTypes = type.types;
			return tuple(elements.map((source, i) => {
				const numeric = parseInt(source, 10);
				switch (numeric) {
					case -1: { // DefaultInitialize
						return defaultInstantiateType(valueTypes[i], scope, returnUndef);
					}
					case -2: { // Variadic
						if (variadicSources.length === 0) {
							throw new Error(`Used more variadic sources than we have`);
						}
						const index = parseInt(variadicSources.shift(), 10);
						if (Number.isNaN(index) || index < 0 || index >= term.children.length) {
							throw new Error(`Invalid variadic index`);
						}
						return values[index];
					}
					case -3: { // CallerDefaultInitialize
						return defaultInstantiateType(valueTypes[i], scope, returnUndef);
					}
					default: {
						if (numeric < 0) {
							throw new Error(`Unknown variadic element type ${source}`);
						}
						if (values.length < 1) {
							expectLength(values, 1);
						}
						const firstValue = values[0];
						if (firstValue.kind === "tuple") {
							if (firstValue.values.length <= numeric) {
								expectLength(firstValue.values, 1);
							}
							return firstValue.values[numeric];
						} else {
							return expr(memberExpression(read(firstValue, scope), literal(numeric), true));
						}
					}
				}
			}));
		}
		case "force_value_expr": {
			expectLength(term.children, 1);
			const value = translateTermToValue(term.children[0], scope, bindingContext);
			const [first, after] = reuseExpression(read(value, scope), scope);
			// TODO: Optimize some cases where we can prove it to be a .some
			const type = getType(term.children[0]);
			return expr(conditionalExpression(
				optionalIsSome(first, type),
				read(unwrapOptional(expr(after), type, scope), scope),
				read(call(forceUnwrapFailed, undefinedValue, [], scope), scope),
			));
		}
		case "try_expr":
		case "force_try_expr": {
			expectLength(term.children, 1);
			// Errors are dispatched via the native throw mechanism in JavaScript, so try expressions don't need special handling
			return translateTermToValue(term.children[0], scope, bindingContext);
		}
		case "optional_try_expr": {
			expectLength(term.children, 1);
			const type = getType(term);
			const tempIdentifier = identifier("$try");
			if (!Object.hasOwnProperty.call(scope.declarations, tempIdentifier.name)) {
				addVariable(scope, tempIdentifier);
			}
			const bodyExpression = read(wrapInOptional(translateTermToValue(term.children[0], scope, bindingContext), type, scope), scope);
			return statements([
				tryStatement(
					blockStatement([
						expressionStatement(assignmentExpression("=", tempIdentifier, bodyExpression)),
					]),
					catchClause(identifier("e"), blockStatement([expressionStatement(assignmentExpression("=", tempIdentifier, emptyOptional(type)))])),
				),
				returnStatement(tempIdentifier),
			]);
		}
		case "erasure_expr": {
			// TODO: Support runtime Any type that can be inspected
			expectLength(term.children, 1, 2);
			return translateTermToValue(term.children[term.children.length - 1], scope, bindingContext);
		}
		case "normal_conformance": {
			// TODO: Wrap with runtime type information
			expectLength(term.children, 1);
			return translateTermToValue(term.children[0], scope, bindingContext);
		}
		case "optional_evaluation_expr": {
			expectLength(term.children, 1);
			const optionalType = getType(term);
			let testExpression: Expression | undefined;
			const someCase = translateTermToValue(term.children[0], scope, (value: Value, innerOptionalType: Type) => {
				if (typeof testExpression !== "undefined") {
					throw new Error(`Expected only one binding expression to bind to this optional evaluation`);
				}
				const [first, after] = reuseExpression(read(value, scope), scope);
				testExpression = optionalIsSome(first, innerOptionalType);
				return unwrapOptional(expr(after), innerOptionalType, scope);
			});
			if (typeof testExpression === "undefined") {
				throw new Error(`Expected a binding expression to bind to this optional evaluation`);
			}
			return expr(conditionalExpression(testExpression, read(someCase, scope), emptyOptional(optionalType)));
		}
		case "bind_optional_expr": {
			if (typeof bindingContext !== "function") {
				throw new Error(`Expected a binding context in order to bind an optional expression`);
			}
			expectLength(term.children, 1);
			const expressionTerm = term.children[0];
			const wrappedValue = translateTermToValue(expressionTerm, scope);
			return bindingContext(wrappedValue, getType(expressionTerm));
		}
		default: {
			console.log(term);
			return variable(identifier("unknown_term_type$" + term.name));
		}
	}
}

function translateAllStatements(terms: Term[], scope: Scope, functions: FunctionMap): Statement[] {
	let tailStatements = emptyStatements;
	let headStatements = emptyStatements;
	for (const term of terms) {
		if (term.name === "defer_stmt") {
			tailStatements = concat(translateStatement(term, scope, functions), tailStatements);
		} else {
			headStatements = concat(headStatements, translateStatement(term, scope, functions));
		}
	}
	if (tailStatements.length) {
		return headStatements.length ? [tryStatement(blockStatement(headStatements), undefined, blockStatement(tailStatements))] : tailStatements;
	} else {
		return headStatements;
	}
}

function translateStatement(term: Term, scope: Scope, functions: FunctionMap): Statement[] {
	switch (term.name) {
		case "source_file": {
			return translateAllStatements(term.children, scope, functions);
		}
		case "accessor_decl":
			if (Object.hasOwnProperty.call(term.properties, "materializeForSet_for")) {
				return emptyStatements;
			}
		case "constructor_decl":
		case "func_decl": {
			const isConstructor = term.name === "constructor_decl";
			expectLength(term.args, 1);
			const name = term.args[0];

			function constructCallable(parameterList: Term[], remainingLists: Term[][], functionType: Type, initialScope?: Scope): (scope: Scope, arg: ArgGetter) => Value {
				return (targetScope: Scope, arg: ArgGetter) => {
					const childScope = typeof initialScope !== "undefined" ? initialScope : newScope(name, targetScope);
					termsWithName(parameterList, "parameter").forEach((param, index) => {
						expectLength(param.args, 1);
						const parameterName = param.args[0];
						targetScope.mapping[parameterName] = hoistToIdentifier(read(arg(index, parameterName), childScope), childScope, parameterName);
					});
					if (remainingLists.length) {
						return callable(constructCallable(remainingLists[0], remainingLists.slice(1), returnType(functionType), initialScope), functionType);
					}
					const brace = findTermWithName(term.children, "brace_stmt");
					if (brace) {
						const body = termWithName(term.children, "brace_stmt").children.slice();
						if (isConstructor) {
							const typeOfResult = returnType(returnType(getType(term)));
							const selfMapping = childScope.mapping.self = uniqueIdentifier(childScope, "self");
							const defaultInstantiation = defaultInstantiateType(typeOfResult, scope, (fieldName) => {
								if (body.length && body[0].name === "assign_expr") {
									const children = body[0].children;
									expectLength(children, 2);
									if (children[0].name === "member_ref_expr") {
										if (parseDeclaration(getProperty(children[0], "decl", isString)).member === fieldName) {
											body.shift();
											return read(translateTermToValue(children[1], childScope), childScope);
										}
									}
								}
								return undefined;
							});
							if (body.length === 1 && body[0].name === "return_stmt" && body[0].properties.implicit) {
								return statements(emitScope(childScope, [returnStatement(read(defaultInstantiation, scope))]));
							}
							addVariable(childScope, selfMapping, read(defaultInstantiation, scope));
						}
						return statements(emitScope(childScope, translateAllStatements(body, childScope, functions)));
					} else {
						if (isConstructor) {
							const typeOfResult = returnType(returnType(getType(term)));
							const selfMapping = childScope.mapping.self = uniqueIdentifier(childScope, "self");
							const defaultInstantiation = defaultInstantiateType(typeOfResult, scope, () => undefined);
							return statements(emitScope(childScope, [returnStatement(read(defaultInstantiation, scope))]));
						} else {
							return statements([]);
						}
					}
				};
			}

			// Workaround differences in AST between swift 4.1 and development
			const parameters = termsWithName(term.children, "parameter");
			const parameterLists = concat(parameters.length ? [parameters] : [], termsWithName(term.children, "parameter_list").map((paramList) => paramList.children));
			if (parameterLists.length === 0) {
				throw new Error(`Expected a parameter list for a function declaration`);
			}

			const fn = constructCallable(parameterLists[0], parameterLists.slice(1), getType(term));
			if (/^anonname=/.test(name)) {
				scope.functions[name] = fn;
			} else if (!isConstructor && term.properties.access === "public" && functions === scope.functions) {
				functions[name] = noinline(fn);
				insertFunction(name, scope, getFunctionType(term), fn, true);
			} else {
				functions[name] = isConstructor ? fn : noinline(fn);
			}
			return emptyStatements;
		}
		case "return_stmt": {
			expectLength(term.children, 0, 1);
			if (term.children.length) {
				const value = translateTermToValue(term.children[0], scope);
				if (value.kind === "statements") {
					return value.statements;
				}
				const expression = read(value, scope);
				if (isIdentifier(expression) && Object.hasOwnProperty.call(scope.declarations, expression.name)) {
					return [returnStatement(expression)];
				}
				const copied = copy(expr(expression), getType(term.children[0]));
				return [returnStatement(read(copied, scope))];
			} else if (term.properties.implicit) {
				return [returnStatement(lookup("self", scope))];
			} else {
				return [returnStatement()];
			}
		}
		case "top_level_code_decl": {
			return translateAllStatements(term.children, scope, functions);
		}
		case "var_decl": {
			expectLength(term.children, 0);
			const name = mangleName(term.args[0]);
			if (Object.hasOwnProperty.call(scope.declarations, name.name)) {
				if (term.properties.access === "public") {
					scope.declarations[name.name] = exportNamedDeclaration(scope.declarations[name.name], []);
				}
			} else {
				const defaultInstantiation = read(defaultInstantiateType(getType(term), scope, returnUndef), scope);
				if (term.properties.access === "public") {
					addExternalVariable(scope, name, defaultInstantiation);
				} else {
					addVariable(scope, name, defaultInstantiation);
				}
			}
			return emptyStatements;
		}
		case "brace_stmt": {
			return translateAllStatements(term.children, scope, functions);
		}
		case "if_stmt": {
			const children = term.children;
			expectLength(children, 2, 3);
			let pattern: PatternOutput;
			const testTerm = children[0];
			if (testTerm.name === "pattern") {
				pattern = translatePattern(testTerm.children[0], translateTermToValue(testTerm.children[1], scope), scope);
			} else {
				pattern = convertToPattern(translateTermToValue(testTerm, scope));
			}
			const { test, prefix, suffix } = flattenPattern(pattern, scope);
			const consequent = concat(suffix, translateStatement(children[1], scope, functions));
			if (isTrueExpression(test)) {
				return concat(prefix, consequent);
			}
			const alternate = children.length === 3 ? blockStatement(translateStatement(children[2], scope, functions)) : undefined;
			return concat(prefix, [ifStatement(test, blockStatement(consequent), alternate)]);
		}
		case "while_stmt": {
			expectLength(term.children, 2);
			const testTerm = term.children[0];
			const bodyTerm = term.children[1];
			return [whileStatement(read(translateTermToValue(testTerm, scope), scope), blockStatement(translateStatement(bodyTerm, scope, functions)))];
		}
		case "switch_stmt": {
			if (term.children.length < 1) {
				throw new Error(`Expected at least one term, got ${term.children.length}`);
			}
			const discriminantTerm = term.children[0];
			const declaration = variableDeclaration("var", [variableDeclarator(identifier("$match"), read(translateTermToValue(discriminantTerm, scope), scope))]);
			const cases = term.children.slice(1).reduceRight((previous: Statement | undefined, childTerm: Term): Statement => {
				checkTermName(childTerm, "case_stmt", "as child of a switch statement");
				if (childTerm.children.length < 1) {
					throw new Error(`Expected at least one term, got ${childTerm.children.length}`);
				}
				const remainingChildren = childTerm.children.slice(0, childTerm.children.length - 1);
				let mergedPrefix: Statement[] = emptyStatements;
				let mergedTest: Expression = literal(false);
				let mergedSuffix: Statement[] = emptyStatements;
				for (const child of remainingChildren) {
					const { prefix, test, suffix } = flattenPattern(translatePattern(child, expr(identifier("$match")), scope), scope);
					mergedPrefix = concat(mergedPrefix, prefix);
					if (valueOfExpression(mergedTest) === false) {
						mergedTest = test;
					} else if (!isTrueExpression(mergedTest)) {
						mergedTest = logicalExpression("||", mergedTest, test);
					}
					mergedSuffix = concat(mergedSuffix, suffix);
				}
				const body = concat(mergedSuffix, translateStatement(childTerm.children[childTerm.children.length - 1], scope, functions));
				// Basic optimization for else case in switch statement
				if (typeof previous === "undefined" && isTrueExpression(mergedTest)) {
					return blockStatement(concat(mergedPrefix, body));
				}
				// Push the if statement into a block if the test required prefix statements
				const pendingStatement = ifStatement(mergedTest, blockStatement(body), previous);
				if (mergedPrefix.length) {
					return blockStatement(concat(mergedPrefix, [pendingStatement]));
				}
				return pendingStatement;
			}, undefined);
			return typeof cases !== "undefined" ? [declaration, cases] : [declaration];
		}
		case "throw_stmt": {
			expectLength(term.children, 1);
			const expressionTerm = term.children[0];
			return [throwStatement(read(translateTermToValue(expressionTerm, scope), scope))];
		}
		case "guard_stmt": {
			expectLength(term.children, 2);
			const testTerm = term.children[0];
			const bodyTerm = term.children[1];
			return [ifStatement(unaryExpression("!", read(translateTermToValue(testTerm, scope), scope)), blockStatement(translateAllStatements(bodyTerm.children, scope, functions)))];
		}
		case "do_catch_stmt": {
			if (term.children.length < 2) {
				expectLength(term.children, 2);
			}
			const bodyTerm = term.children[0];
			checkTermName(bodyTerm, "brace_stmt", "as first child of a do catch statement");
			return term.children.slice(1).reduce((statements, catchTerm) => {
				checkTermName(catchTerm, "catch", "as non-first child of a do catch");
				expectLength(catchTerm.children, 2);
				const patternTerm = catchTerm.children[0];
				checkTermName(patternTerm, "pattern_let", "as child of a catch pattern");
				expectLength(patternTerm.children, 1);
				const letPatternChild = patternTerm.children[0];
				checkTermName(letPatternChild, "pattern_named", "as child of a catch pattern let expression");
				expectLength(letPatternChild.args, 1);
				const catchClauseExpression = identifier(letPatternChild.args[0]);
				const catchBodyTerm = catchTerm.children[1];
				checkTermName(catchBodyTerm, "brace_stmt", "as only child of a catch clause");
				const catchBodyStatements = translateAllStatements(catchBodyTerm.children, scope, functions);
				return [tryStatement(blockStatement(statements), catchClause(catchClauseExpression, blockStatement(catchBodyStatements)))];
			}, translateAllStatements(bodyTerm.children, scope, functions));
		}
		case "defer_stmt": {
			expectLength(term.children, 2);
			const firstChild = term.children[0];
			checkTermName(firstChild, "func_decl", "as second child of a defer statement");
			expectLength(firstChild.children, 2);
			checkTermName(firstChild.children[0], "parameter_list", "as first child of defer statement function");
			expectLength(firstChild.children[0].children, 0);
			checkTermName(firstChild.children[1], "brace_stmt", "as second child of defer statement function");
			checkTermName(term.children[1], "call_expr", "as second child of a defer statement");
			return translateAllStatements(firstChild.children[1].children, scope, functions);
		}
		case "enum_decl": {
			expectLength(term.args, 1);
			const inherits = term.properties.inherits;
			const baseType = typeof inherits === "string" ? parseType(inherits) : undefined;
			const baseReifiedType = typeof baseType !== "undefined" ? reifyType(baseType, scope) : undefined;
			let statements = emptyStatements;
			const enumName = term.args[0];
			const copyFunctionName = `${enumName}.copy`;
			const methods: FunctionMap = {
				[copyFunctionName]: noinline((innerScope, arg) => copyHelper(arg(0, "source"), innerScope)),
			};
			function copyHelper(value: Value, innerScope: Scope): Value {
				// Passthrough to the underlying type, which should generally be simple
				if (baseReifiedType) {
					return baseReifiedType.copy ? baseReifiedType.copy(value, innerScope) : value;
				}
				const expression = read(value, innerScope);
				if (expressionSkipsCopy(expression)) {
					return expr(expression);
				}
				if (requiresCopyHelper) {
					// Emit checks for cases that have field that require copying
					const [first, after] = reuseExpression(expression, scope);
					let usedFirst = false;
					return expr(cases.reduce(
						(previous, enumCase, i) => {
							if (enumCase.fieldTypes.some((fieldType) => !!fieldType.copy)) {
								const test = binaryExpression("===", memberExpression(usedFirst ? after : first, literal(0), true), literal(i));
								usedFirst = true;
								const copyCase = arrayExpression(concat([literal(i) as Expression], enumCase.fieldTypes.map((fieldType, fieldIndex) => {
									// if (fieldType === baseReifiedType) {
										// TODO: Avoid resetting this each time
										// methods["$copy"] = noinline((innermostScope, arg) => copyHelper(arg(0), innermostScope));
									// }
									const fieldExpression = memberExpression(after, literal(fieldIndex + 1), true);
									return fieldType.copy ? read(fieldType.copy(expr(fieldExpression), scope), scope) : fieldExpression;
								})));
								return conditionalExpression(test, copyCase, previous);
							} else {
								return previous;
							}
						},
						// Fallback to slicing the array for remaining simple cases
						callExpression(memberExpression(after, identifier("slice")), []) as Expression,
					));
				} else {
					return call(expr(memberExpression(expression, identifier("slice"))), undefinedValue, [], innerScope);
				}
			}
			const layout: Field[] = [];
			let requiresCopyHelper: boolean = false;
			const cases: EnumCase[] = [];
			const selfType: Type = {
				kind: "name",
				name: enumName,
			};
			// Reify self
			const reifiedSelfType: ReifiedType = {
				fields: layout,
				functions: methods,
				possibleRepresentations: baseReifiedType ? baseReifiedType.possibleRepresentations : PossibleRepresentation.Array,
				defaultValue() {
					throw new Error(`Unable to default instantiate enums`);
				},
				innerTypes: {},
				copy: baseReifiedType ? baseReifiedType.copy : (value, innerScope) => {
					// Skip the copy if we can—must be done on this side of the inlining boundary
					const expression = read(value, scope);
					if (expressionSkipsCopy(expression)) {
						return expr(expression);
					}
					if (!requiresCopyHelper) {
						return copyHelper(expr(expression), innerScope);
					}
					// Dispatch through the function so that recursion doesn't kill us
					const copyFunctionType: Function = { kind: "function", arguments: { kind: "tuple", types: [selfType] }, return: selfType, throws: false, rethrows: false, attributes: [] };
					return call(functionValue(copyFunctionName, reifiedSelfType, copyFunctionType), undefinedValue, [expr(expression)], scope);
				},
				cases,
			};
			scope.types[enumName] = () => reifiedSelfType;
			// Populate each case
			termsWithName(term.children, "enum_case_decl").forEach((caseDecl, index) => {
				const elementDecl = termWithName(caseDecl.children, "enum_element_decl");
				expectLength(elementDecl.args, 1);
				// TODO: Extract the actual rawValue and use this as the discriminator
				const name = elementDecl.args[0].match(/^[^\(]*/)![0];
				const type = returnType(getType(elementDecl));
				if (type.kind === "function") {
					methods[name] = wrapped((innerScope, arg) => {
						const args = type.arguments.types.map((argType, argIndex) => read(copy(arg(argIndex), argType), innerScope));
						return expr(arrayExpression(concat([literal(index)], args)));
					});
					cases.push({
						name,
						fieldTypes: type.arguments.types.map((argType) => {
							const reified = reifyType(argType, scope);
							if (reified.copy) {
								requiresCopyHelper = true;
							}
							return reified;
						}),
					});
					return;
				}
				if (baseType) {
					// TODO: Extract the underlying value, which may actually not be numeric!
					methods[name] = () => expr(literal(index));
				} else {
					methods[name] = () => expr(arrayExpression([literal(index)]));
				}
				cases.push({
					name,
					fieldTypes: [],
				});
			});
			// Populate fields and members
			for (const child of term.children) {
				if (child.name === "var_decl") {
					expectLength(child.args, 1);
					if (requiresGetter(child)) {
						expectLength(child.children, 1);
						const declaration = findTermWithName(child.children, "func_decl") || termWithName(child.children, "accessor_decl");
						const fieldName = child.args[0];
						if (fieldName === "rawValue") {
							// The built-in rawValue accessors don't have proper pattern matching :(
							if (baseReifiedType) {
								layout.push(field("rawValue", baseReifiedType, (value, innerScope) => copy(value, baseType!)));
							} else {
								throw new TypeError(`Unable to synthesize rawValue for ${enumName}`);
							}
						} else if (fieldName === "hashValue") {
							// The built-in hashValue accessors don't have proper pattern matching :(
							if (baseReifiedType) {
								const passthroughField = baseReifiedType.fields.find((field) => field.name === "hashValue");
								if (!passthroughField) {
									throw new Error(`Unable to synthsize hashValue for ${enumName} because underlying type ${inherits} does not have a hashValue`);
								}
								layout.push(passthroughField);
							} else {
								throw new TypeError(`Unable to synthesize hashValue for ${enumName}`);
							}
						} else {
							layout.push(field(fieldName, reifyType(getType(child), scope), (value: Value, innerScope: Scope) => {
								return call(call(functionValue(declaration.args[0], undefined, getFunctionType(declaration)), undefinedValue, [value], innerScope), undefinedValue, [], innerScope);
							}));
						}
						statements = concat(statements, translateStatement(child.children[0], scope, methods));
					} else {
						throw new TypeError(`Enums should not have any stored fields`);
					}
				} else if (child.name !== "enum_case_decl" && child.name !== "enum_element_decl" && child.name !== "typealias") {
					statements = concat(statements, translateStatement(child, scope, methods));
				}
			}
			return statements;
		}
		case "struct_decl": {
			expectLength(term.args, 1);
			let statements: Statement[] = [];
			const layout: Field[] = [];
			const methods: FunctionMap = {};
			for (const child of term.children) {
				if (child.name === "var_decl") {
					expectLength(child.args, 1);
					if (requiresGetter(child)) {
						expectLength(child.children, 1);
						layout.push(field(child.args[0], reifyType(getType(child), scope), (value: Value, innerScope: Scope) => {
							const declaration = findTermWithName(child.children, "func_decl") || termWithName(child.children, "accessor_decl");
							return call(call(functionValue(declaration.args[0], undefined, getFunctionType(declaration)), undefinedValue, [value], innerScope), undefinedValue, [], innerScope);
						}));
						statements = concat(statements, translateStatement(child.children[0], scope, methods));
					} else {
						layout.push(field(child.args[0], reifyType(getType(child), scope)));
					}
				} else {
					statements = concat(statements, translateStatement(child, scope, methods));
				}
			}
			scope.types[term.args[0]] = () => struct(layout, methods);
			return statements;
		}
		case "pattern_binding_decl": {
			if (term.children.length === 2) {
				const value = translateTermToValue(term.children[1], scope);
				const pattern = translatePattern(term.children[0], value, scope);
				if (typeof pattern.next !== "undefined") {
					throw new Error(`Chained patterns are not supported on binding declarations`);
				}
				const expression = read(pattern.test, scope);
				if (isPure(expression)) {
					return pattern.prefix;
				} else {
					return pattern.prefix.concat([expressionStatement(expression)]);
				}
			}
			if (term.children.length === 1) {
				return emptyStatements;
			}
			throw new Error(`Expected 1 or 2 terms, got ${term.children.length}`);
		}
		case "class_decl": {
			expectLength(term.args, 1);
			const layout: Field[] = [];
			const methods: FunctionMap = {};
			for (const child of term.children) {
				if (child.name === "var_decl") {
					expectLength(child.args, 1);
					if (requiresGetter(child)) {
						// TODO: Implement getters/setters
						layout.push(field(child.args[0], reifyType(getType(child), scope)));
						// expectLength(child.children, 1);
						// layout.push(structField(child.args[0], getType(child), (value: Value, innerScope: Scope) => {
						// 	const declaration = findTermWithName(child.children, "func_decl") || termWithName(child.children, "accessor_decl");
						// 	return call(call(functionValue(declaration.args[0], getType(declaration)), undefinedValue, [value], innerScope), undefinedValue, [], innerScope);
						// }));
					} else {
						layout.push(field(child.args[0], reifyType(getType(child), scope)));
					}
				}
			}
			scope.types[term.args[0]] = () => newClass(layout, methods);
			// TODO: Fill in body
			return [classDeclaration(mangleName(term.args[0]), undefined, classBody([]), [])];
		}
		default: {
			const value = translateTermToValue(term, scope);
			const pattern = convertToPattern(value);
			const { prefix, test, suffix } = flattenPattern(pattern, scope);
			let result = prefix;
			if (!isPure(test)) {
				if (test.type === "ConditionalExpression") {
					result = concat(result, [ifStatement(
						test.test,
						blockStatement(isPure(test.consequent) ? [] : [expressionStatement(test.consequent)]),
						isPure(test.alternate) ? undefined : blockStatement([expressionStatement(test.alternate)]),
					)]);
				} else {
					result = concat(result, [expressionStatement(test)]);
				}
			}
			return concat(result, suffix);
		}
	}
}

export function compileTermToProgram(root: Term): Program {
	const programScope = newScopeWithBuiltins();
	return program(emitScope(programScope, translateStatement(root, programScope, programScope.functions)));
}

function readAsString(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		stream.setEncoding("utf8");
		stream.resume();
		const input: any[] = [];
		stream.on("data", (chunk) => input.push(chunk));
		stream.on("end", () => resolve(input.join("")));
		stream.on("error", reject);
	});
}

const swiftPath: string = (() => {
	try {
		// Search toolchains
		let hasLatest: boolean = false;
		const developmentToolchains: string[] = [];
		for (const subpath of readdirSync("/Library/Developer/Toolchains/")) {
			if (/^swift-DEVELOPMENT-SNAPSHOT-.*\.xctoolchain$/.test(subpath)) {
				developmentToolchains.push(`/Library/Developer/Toolchains/${subpath}/usr/bin/swiftc`);
			} else if (subpath === "swift-latest.xctoolchain") {
				hasLatest = true;
			}
		}
		// Attempt to use the latest development toolchain
		if (developmentToolchains.length) {
			developmentToolchains.sort();
			return developmentToolchains[developmentToolchains.length - 1];
		}
		// Or the latest symlink
		if (hasLatest) {
			return "/Library/Developer/Toolchains/swift-latest.xctoolchain/usr/bin/swiftc";
		}
		// Or whatever the installed Xcode version has
		return "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc";
	} catch (e) {
		// Or the swiftc in the user's path
		return "swiftc";
	}
})();

export interface CompilerOutput {
	code: string | undefined;
	ast: string;
}

export async function compile(path: string): Promise<CompilerOutput> {
	const process = spawn(swiftPath, ["-dump-ast", "--", path]);
	const stdout = readAsString(process.stdout);
	const stderr = readAsString(process.stderr);
	await new Promise((resolve, reject) => {
		process.on("exit", async (code, signal) => {
			if (code !== 0) {
				const lines = (await stderr).split(/\r\n|\r|\n/g);
				const bracketIndex = lines.findIndex((line) => /^\(/.test(line));
				const filteredLines = bracketIndex !== -1 ? lines.slice(0, bracketIndex) : lines;
				reject(new Error(filteredLines.join("\n")));
			} else {
				resolve();
			}
		});
	});
	let ast = await stderr;
	if (ast[0] !== "(") {
		const lines = (await stderr).split(/\r\n|\r|\n/g);
		const bracketIndex = lines.findIndex((line) => /^\(/.test(line));
		console.error(lines.slice(0, bracketIndex).join("\n"));
		ast = lines.slice(bracketIndex).join("\n");
	}
	// console.log(ast);
	const rootTerm = parseAST(ast);
	await stdout;
	const program = compileTermToProgram(rootTerm);
	return { code: transformFromAst(program).code, ast };
}

if (require.main === module) {
	compile(argv[argv.length - 1]).then((result) => console.log(result.code)).catch((e) => {
		// console.error(e instanceof Error ? e.message : e);
		console.error(e);
		process.exit(1);
	});
}
