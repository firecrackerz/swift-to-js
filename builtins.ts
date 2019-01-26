import { abstractMethod, noinline, returnFunctionType, wrapped, wrappedSelf, FunctionBuilder } from "./functions";
import { parseFunctionType } from "./parse";
import { expressionSkipsCopy, inheritLayout, primitive, protocol, reifyType, withPossibleRepresentations, FunctionMap, PossibleRepresentation, ProtocolConformance, ProtocolConformanceMap, ReifiedType, TypeMap } from "./reified";
import { addVariable, lookup, mangleName, uniqueName, DeclarationFlags, MappedNameValue, Scope } from "./scope";
import { Function, Tuple } from "./types";
import { concat, lookupForMap } from "./utils";
import { array, binary, call, callable, conditional, conformance, copy, expr, expressionLiteralValue, functionValue, hasRepresentation, ignore, isPure, literal, logical, member, read, representationsForTypeValue, reuse, set, statements, stringifyValue, transform, tuple, typeFromValue, typeTypeValue, typeValue, unary, undefinedValue, update, updateOperatorForBinaryOperator, ArgGetter, BinaryOperator, ExpressionValue, Value } from "./values";

import { arrayBoundsFailed, Array as ArrayBuiltin } from "./builtins/Array";
import { Bool as BoolBuiltin } from "./builtins/Bool";
import { emptyOptional, optionalIsSome, unwrapOptional, wrapInOptional, Optional as OptionalBuiltin } from "./builtins/Optional";
import { String as StringBuiltin } from "./builtins/String";

import { arrayPattern, blockStatement, breakStatement, expressionStatement, forInStatement, forStatement, identifier, ifStatement, isLiteral, newExpression, objectExpression, objectProperty, returnStatement, throwStatement, updateExpression, variableDeclaration, variableDeclarator, whileStatement, Identifier, Node, Statement } from "@babel/types";

function returnOnlyArgument(scope: Scope, arg: ArgGetter): Value {
	return arg(0, "value");
}

export function returnTodo(scope: Scope, arg: ArgGetter, name: string): Value {
	console.error(name);
	return call(expr(mangleName("todo_missing_builtin$" + name)), [], [], scope);
}

function unavailableFunction(scope: Scope, arg: ArgGetter, name: string): Value {
	throw new Error(`${name} is not available`);
}

export function binaryBuiltin(operator: BinaryOperator, typeArgumentCount: number, valueChecker?: (value: Value, scope: Scope) => Value) {
	return (scope: Scope, arg: ArgGetter) => {
		const unchecked = binary(operator,
			arg(typeArgumentCount, "lhs"),
			arg(typeArgumentCount + 1, "rhs"),
			scope,
		);
		return typeof valueChecker !== "undefined" ? valueChecker(unchecked, scope) : unchecked;
	};
}

function updateBuiltin(operator: keyof typeof updateOperatorForBinaryOperator, typeArgumentCount: number, valueChecker?: (value: Value, scope: Scope) => Value) {
	if (typeof valueChecker !== "undefined") {
		return (scope: Scope, arg: ArgGetter) => update(arg(typeArgumentCount, "target"), scope, (value) => valueChecker(binary(operator, value, arg(typeArgumentCount + 1, "value"), scope), scope));
	}
	return (scope: Scope, arg: ArgGetter) => set(arg(typeArgumentCount, "target"), arg(typeArgumentCount + 1, "value"), scope, updateOperatorForBinaryOperator[operator]);
}

export const readLengthField = wrapped((scope: Scope, arg: ArgGetter) => {
	return member(arg(0, "self"), "length", scope);
}, "(Any) -> Int");

export const isEmptyFromLength = wrapped((scope: Scope, arg: ArgGetter) => {
	return binary("!==", member(arg(0, "self"), "length", scope), literal(0), scope);
}, "(Any) -> Bool");

export const startIndexOfZero = wrapped((scope: Scope, arg: ArgGetter) => {
	return literal(0);
}, "(Any) -> Int");

export const voidType: Tuple = { kind: "tuple", types: [] };

export const forceUnwrapFailed: Value = functionValue("Swift.(swift-to-js).forceUnwrapFailed()", undefined, { kind: "function", arguments: voidType, return: voidType, throws: true, rethrows: false, attributes: [] });

export function cachedBuilder(fn: (scope: Scope) => ReifiedType): (scope: Scope) => ReifiedType {
	let value: ReifiedType | undefined;
	return (scope: Scope) => {
		if (typeof value === "undefined") {
			return value = fn(scope);
		}
		return value;
	};
}

function buildIntegerType(globalScope: Scope, min: number, max: number, bitWidth: number, checked: boolean, wrap: (value: Value, scope: Scope) => Value): ReifiedType {
	const range: NumericRange = { min: literal(min), max: literal(max) };
	const widerHigh: NumericRange = checked ? { min: literal(min), max: literal(max + 1) } : range;
	const widerLow: NumericRange = checked ? { min: literal(min - 1), max: literal(max) } : range;
	const widerBoth: NumericRange = checked ? { min: literal(min - 1), max: literal(max + 1) } : range;
	const integerTypeName = min < 0 ? "SignedInteger" : "UnsignedInteger";
	function initExactly(outerScope: Scope, outerArg: ArgGetter): Value {
		const destTypeArg = outerArg(1, "T");
		return callable((scope: Scope, arg: ArgGetter) => {
			const destIntConformance = conformance(destTypeArg, integerTypeName, scope);
			const dest = rangeForNumericType(destIntConformance, scope);
			const requiresGreaterThanCheck = possiblyGreaterThan(range, dest, scope);
			const requiresLessThanCheck = possiblyLessThan(range, dest, scope);
			if (!requiresGreaterThanCheck && !requiresLessThanCheck) {
				return arg(0, "value");
			}
			return reuseArgs(arg, 0, scope, ["value"], (value) => {
				let check;
				if (requiresGreaterThanCheck && requiresLessThanCheck) {
					check = logical(
						"||",
						binary(">", value, dest.min, scope),
						binary("<", value, dest.max, scope),
						scope,
					);
				} else if (requiresGreaterThanCheck) {
					check = binary(">", value, dest.max, scope);
				} else if (requiresLessThanCheck) {
					check = binary("<", value, dest.min, scope);
				} else {
					return value;
				}
				return conditional(
					check,
					literal(null),
					value,
					scope,
				);
			});
		}, "(Self) -> Self");
	}
	const customStringConvertibleConformance: ProtocolConformance = {
		functions: {
			description: wrapped((scope, arg) => call(expr(identifier("String")), [arg(0, "self")], ["Self"], scope), "(Self) -> String"),
		},
		requirements: [],
	};
	const hashableConformance: ProtocolConformance = {
		functions: {
			hashValue: wrapped((scope, arg) => arg(0, "self"), "(Self) -> Int"),
		},
		requirements: [],
	};
	const equatableConformance: ProtocolConformance = {
		functions: {
			"==": wrapped(binaryBuiltin("===", 0), "(Self, Self) -> Bool"),
			"!=": wrapped(binaryBuiltin("!==", 0), "(Self, Self) -> Bool"),
		},
		requirements: [],
	};
	const additiveArithmeticConformance: ProtocolConformance = {
		functions: {
			"zero": wrapped(() => literal(0), "() -> Self"),
			"+": wrapped(binaryBuiltin("+", 0, (value, scope) => integerRangeCheck(scope, value, widerHigh, range)), "(Self, Self) -> Self"),
			"-": wrapped(binaryBuiltin("-", 0, (value, scope) => integerRangeCheck(scope, value, widerLow, range)), "(Self, Self) -> Self"),
		},
		requirements: [],
	};
	const numericConformance: ProtocolConformance = {
		functions: {
			"init(exactly:)": initExactly,
			"*": wrapped(binaryBuiltin("*", 0, (value, scope) => integerRangeCheck(scope, value, widerBoth, range)), "(Self, Self) -> Self"),
		},
		requirements: [],
	};
	const signedNumericConformance: ProtocolConformance = {
		functions: {
			"-": wrapped((scope, arg) => unary("-", arg(0, "value"), scope), "(Self) -> Self"),
		},
		requirements: [],
	};
	const comparableConformance: ProtocolConformance = {
		functions: {
			"<": wrapped(binaryBuiltin("<", 0), "(Self, Self) -> Bool"),
			">": wrapped(binaryBuiltin(">", 0), "(Self, Self) -> Bool"),
			"<=": wrapped(binaryBuiltin("<=", 0), "(Self, Self) -> Bool"),
			">=": wrapped(binaryBuiltin(">=", 0), "(Self, Self) -> Bool"),
		},
		requirements: [],
	};
	const strideableConformance: ProtocolConformance = {
		functions: {
			"+": wrapped((scope, arg) => integerRangeCheck(scope, binary("+", arg(0, "lhs"), arg(1, "rhs"), scope), widerHigh, range), "(Self, Self) -> Self"),
			"-": wrapped((scope, arg) => integerRangeCheck(scope, binary("-", arg(0, "lhs"), arg(1, "rhs"), scope), widerLow, range), "(Self, Self) -> Self"),
			"...": wrapped((scope, arg) => {
				return tuple([arg(0, "start"), arg(1, "end")]);
			}, "(Self, Self) -> Self"),
			"==": wrapped(binaryBuiltin("===", 0), "(Self, Self) -> Bool"),
		},
		requirements: [],
	};
	const binaryIntegerConformance: ProtocolConformance = {
		functions: {
			"init(exactly:)": initExactly,
			"init(truncatingIfNeeded:)": wrapped((scope: Scope, arg: ArgGetter) => {
				return wrap(arg(0, "source"), scope);
			}, "(T) -> Self"),
			"init(clamping:)": (scope: Scope, arg: ArgGetter, name: string) => {
				const dest = rangeForNumericType(conformance(arg(1, "T"), integerTypeName, scope), scope);
				return callable((innerScope, innerArg) => {
					const requiresGreaterThanCheck = possiblyGreaterThan(range, dest, scope);
					const requiresLessThanCheck = possiblyLessThan(range, dest, scope);
					if (!requiresGreaterThanCheck && !requiresLessThanCheck) {
						return innerArg(0, "value");
					}
					return reuse(innerArg(0, "value"), innerScope, "value", (value) => {
						if (requiresGreaterThanCheck && requiresLessThanCheck) {
							return conditional(
								binary(">", value, dest.max, innerScope),
								dest.max,
								conditional(
									binary("<", value, dest.min, innerScope),
									dest.min,
									value,
									innerScope,
								),
								innerScope,
							);
						} else if (requiresGreaterThanCheck) {
							return conditional(
								binary(">", value, dest.max, innerScope),
								dest.max,
								value,
								innerScope,
							);
						} else {
							return conditional(
								binary("<", value, dest.min, innerScope),
								dest.min,
								value,
								innerScope,
							);
						}
					});
				}, "(Self) -> Self");
			},
			"/": wrapped((scope, arg) => binary("|", binary("/", arg(0, "lhs"), arg(1, "rhs"), scope), literal(0), scope), "(Self, Self) -> Self"),
			"%": wrapped((scope, arg) => binary("%", arg(0, "lhs"), arg(1, "rhs"), scope), "(Self, Self) -> Self"),
			"+": wrapped((scope, arg) => integerRangeCheck(scope, binary("+", arg(0, "lhs"), arg(1, "rhs"), scope), widerHigh, range), "(Self, Self) -> Self"),
			"-": wrapped((scope, arg) => integerRangeCheck(scope, binary("-", arg(0, "lhs"), arg(1, "rhs"), scope), widerLow, range), "(Self, Self) -> Self"),
			"*": wrapped((scope, arg) => integerRangeCheck(scope, binary("*", arg(0, "lhs"), arg(1, "rhs"), scope), widerBoth, range), "(Self, Self) -> Self"),
			"~": wrapped((scope, arg) => wrap(unary("~", arg(0, "self"), scope), scope), "(Self) -> Self"),
			">>": wrapped((scope, arg) => binary(">>", arg(0, "lhs"), arg(1, "rhs"), scope), "(Self, Self) -> Self"),
			"<<": wrapped((scope, arg) => binary("<<", arg(0, "lhs"), arg(1, "rhs"), scope), "(Self, Self) -> Self"), // TODO: Implement shift left
			"<": wrapped(binaryBuiltin("<", 0), "(Self, Self) -> Bool"),
			">": wrapped(binaryBuiltin(">", 0), "(Self, Self) -> Bool"),
			"<=": wrapped(binaryBuiltin("<=", 0), "(Self, Self) -> Bool"),
			">=": wrapped(binaryBuiltin(">=", 0), "(Self, Self) -> Bool"),
			"&": wrapped(binaryBuiltin("&", 0), "(Self, Self) -> Self"),
			"|": wrapped(binaryBuiltin("|", 0), "(Self, Self) -> Self"),
			"^": wrapped(binaryBuiltin("^", 0), "(Self, Self) -> Self"),
			"quotientAndRemainder(dividingBy:)": wrapped((scope, arg) => {
				return reuseArgs(arg, 0, scope, ["lhs", "rhs"], (lhs, rhs) => {
					return tuple([
						binary("|", binary("/", lhs, rhs, scope), literal(0), scope),
						binary("%", lhs, rhs, scope),
					]);
				});
			}, "(Self, Self) -> (Self, Self)"),
			"signum": wrapped((scope, arg) => {
				return reuseArgs(arg, 0, scope, ["self"], (int) => {
					if (min < 0) {
						return conditional(
							binary(">", int, literal(0), scope),
							literal(1),
							conditional(
								binary("<", int, literal(0), scope),
								literal(-1),
								int,
								scope,
							),
							scope,
						);
					} else {
						return conditional(
							binary(">", int, literal(0), scope),
							literal(1),
							int,
							scope,
						);
					}
				});
			}, "(Self) -> Self"),
			"isSigned": wrapped((scope, arg) => {
				return literal(min < 0);
			}, "() -> Bool"),
		},
		requirements: [],
	};
	const byteSwapped = wrapped((scope, arg) => {
		if (bitWidth <= 8) {
			return arg(0, "value");
		}
		return reuseArgs(arg, 0, scope, ["value"], (self) => {
			let result: Value = literal(0);
			for (let i = 0; i < bitWidth; i += 8) {
				const shiftAmount = bitWidth - 8 - i * 2;
				const shifted = binary(shiftAmount > 0 ? ">>" : "<<", self, literal(shiftAmount > 0 ? shiftAmount : -shiftAmount), scope);
				result = binary("|",
					result,
					shiftAmount !== -24 ? binary("&", shifted, literal(0xFF << i), scope) : shifted,
					scope,
				);
			}
			return result;
		});
	}, "(Self) -> Self");
	const fixedWidthIntegerConformance: ProtocolConformance = {
		functions: {
			"init(_:radix:)": wrapped((scope, arg) => {
				const input = read(arg(0, "text"), scope);
				const result = uniqueName(scope, "integer");
				return statements([
					addVariable(scope, result, "Int", call(expr(identifier("parseInt")), [
						expr(input),
						arg(1, "radix"),
					], ["String", "Int"], scope), DeclarationFlags.Const),
					returnStatement(
						read(conditional(
							binary("!==",
								lookup(result, scope),
								lookup(result, scope),
								scope,
							),
							literal(null),
							lookup(result, scope),
							scope,
						), scope),
					),
				]);
			}, "(String, Int) -> Self?"),
			"min": wrapped((scope, arg) => literal(min), "() -> Self"),
			"max": wrapped((scope, arg) => literal(max), "() -> Self"),
			"littleEndian": wrapped((scope, arg) => arg(0, "self"), "(Self) -> Self"),
			"bigEndian": byteSwapped,
			"byteSwapped": byteSwapped,
			"bitWidth": wrapped((scope, arg) => literal(bitWidth), "() -> Self"),
			"&+": wrapped(binaryBuiltin("+", 0, wrap), "(Self, Self) -> Self"),
			"&*": wrapped(binaryBuiltin("*", 0, wrap), "(Self, Self) -> Self"),
			"&-": wrapped(binaryBuiltin("-", 0, wrap), "(Self, Self) -> Self"),
			"&<<": wrapped(binaryBuiltin("<<", 0, wrap), "(Self, Self) -> Self"),
			"&>>": wrapped(binaryBuiltin(">>", 0, wrap), "(Self, Self) -> Self"),
			"addingReportingOverflow(_:)": wrapped((scope, arg) => reuse(binary("+", arg(0, "lhs"), arg(1, "rhs"), scope), scope, "full", (full) => {
				return reuse(wrap(full, scope), scope, "truncated", (truncated) => {
					return tuple([truncated, binary("!==", truncated, full, scope)]);
				});
			}), "(Self, Self) -> (Self, Bool)"),
			"subtractingReportingOverflow(_:)": wrapped((scope, arg) => reuse(binary("-", arg(0, "lhs"), arg(1, "rhs"), scope), scope, "full", (full) => {
				return reuse(wrap(full, scope), scope, "truncated", (truncated) => {
					return tuple([truncated, binary("!==", truncated, full, scope)]);
				});
			}), "(Self, Self) -> (Self, Bool)"),
			"multipliedReportingOverflow(by:)": wrapped((scope, arg) => reuse(binary("*", arg(0, "lhs"), arg(1, "rhs"), scope), scope, "full", (full) => {
				return reuse(wrap(full, scope), scope, "truncated", (truncated) => {
					return tuple([truncated, binary("!==", truncated, full, scope)]);
				});
			}), "(Self, Self) -> (Self, Bool)"),
			"dividedReportingOverflow(by:)": wrapped((scope, arg) => reuse(binary("|", binary("/", arg(0, "lhs"), arg(1, "rhs"), scope), literal(0), scope), scope, "full", (full) => {
				return reuse(wrap(full, scope), scope, "truncated", (truncated) => {
					return tuple([truncated, binary("!==", truncated, full, scope)]);
				});
			}), "(Self, Self) -> (Self, Bool)"),
			"remainderReportingOverflow(dividingBy:)": wrapped((scope, arg) => reuse(binary("%", arg(0, "lhs"), arg(1, "rhs"), scope), scope, "full", (full) => {
				return reuse(wrap(full, scope), scope, "truncated", (truncated) => {
					return tuple([truncated, binary("!==", truncated, full, scope)]);
				});
			}), "(Self, Self) -> (Self, Bool)"),
			"nonzeroBitCount": wrapped((scope, arg) => reuse(arg(0, "value"), scope, "value", (value, literalValue) => {
				if (typeof literalValue === "number") {
					// Population count of a literal
					let count: number = 0;
					let current = literalValue;
					while (current) {
						count++;
						current &= current - 1;
					}
					return literal(count);
				}
				// Population count at runtime
				const currentName = uniqueName(scope, "current");
				const currentDeclaration = addVariable(scope, currentName, "Self", value);
				const countName = uniqueName(scope, "count");
				const countDeclaration = addVariable(scope, countName, "Self", literal(0));
				return statements([
					currentDeclaration,
					countDeclaration,
					whileStatement(
						identifier(currentName),
						blockStatement(concat(
							ignore(set(
								lookup(countName, scope),
								literal(1),
								scope,
								"+=",
							), scope),
							ignore(set(
								lookup(currentName, scope),
								binary("-", lookup(currentName, scope), literal(1), scope),
								scope,
								"&=",
							), scope),
						)),
					),
					returnStatement(identifier(countName)),
				]);
			}), "(Self) -> Self"),
			"leadingZeroBitCount": wrapped((scope, arg) => reuse(arg(0, "value"), scope, "value", (value, literalValue) => {
				if (typeof literalValue === "number") {
					// Count leading zero bits of literal
					let shift = bitWidth;
					// tslint:disable-next-line:no-empty
					while (literalValue >> --shift === 0 && shift >= 0) {
					}
					return literal(bitWidth - 1 - shift);
				}
				// Count leading zero bits at runtime
				const shiftName = uniqueName(scope, "shift");
				const shiftDeclaration = addVariable(scope, shiftName, "Self", literal(bitWidth));
				return statements([
					shiftDeclaration,
					whileStatement(
						read(
							logical("&&",
								binary("===",
									binary(">>",
										value,
										expr(updateExpression("--", identifier(shiftName), true)),
										scope,
									),
									literal(0),
									scope,
								),
								binary(">=",
									lookup(shiftName, scope),
									literal(0),
									scope,
								),
								scope,
							),
							scope,
						),
						blockStatement([]),
					),
					returnStatement(read(binary("-", literal(bitWidth - 1), lookup(shiftName, scope), scope), scope)),
				]);
			}), "(Self) -> Self"),
			"multipliedFullWidth(by:)": wrapped((scope, arg) => {
				const magnitudeBitWidth = min < 0 ? bitWidth - 1 : bitWidth;
				if (bitWidth <= 16) {
					return reuse(binary("*", arg(0, "lhs"), arg(1, "rhs"), scope), scope, "multiplied", (multiplied) => {
						return tuple([
							binary(">>", multiplied, literal(magnitudeBitWidth), scope),
							binary("&", multiplied, literal((1 << magnitudeBitWidth) - 1), scope),
						]);
					});
				}
				return reuse(arg(0, "lhs"), scope, "lhs", (lhs, lhsLiteral) => {
					return reuse(arg(1, "rhs"), scope, "rhs", (rhs, rhsLiteral) => {
						return tuple([
							binary("|", binary("/", binary("*", lhs, rhs, scope), literal(Math.pow(2, 32)), scope), literal(0), scope),
							typeof lhsLiteral === "number" && typeof rhsLiteral === "number" ?
								literal(Math.imul(lhsLiteral, rhsLiteral)) :
								call(member(expr(identifier("Math")), "imul", scope), [
									lhs,
									rhs,
								], ["String", "Int"], scope),
						]);
					});
				});
			}, "(Self, Self) -> Self"),
			"dividingFullWidth(_:)": wrapped((scope) => {
				return call(functionValue("Swift.(swift-to-js).notImplemented()", undefined, { kind: "function", arguments: voidType, return: voidType, throws: true, rethrows: false, attributes: [] }), [], [], scope);
			}, "((Self, Self)) -> (Self, Self)"),
		},
		requirements: [],
	};
	const integerConformance: ProtocolConformance = {
		functions: {
			"min": wrapped(() => {
				return literal(min);
			}, "() -> Int"),
			"max": wrapped(() => {
				return literal(max);
			}, "() -> Int"),
			"init(_:)": (outerScope, outerArg) => {
				const sourceTypeArg = outerArg(1, "T");
				return callable((scope, arg) => {
					const sourceType = conformance(sourceTypeArg, integerTypeName, scope);
					return integerRangeCheck(
						scope,
						arg(0, "value"),
						range,
						rangeForNumericType(sourceType, scope),
					);
				}, "(Self) -> Self");
			},
			"init(exactly:)": initExactly,
		},
		requirements: [],
	};
	if (min < 0) {
		// Only SignedInteger has these methods
		integerConformance.functions["&+"] = wrapped(binaryBuiltin("+", 0, wrap), "(Self, Self) -> Self");
		integerConformance.functions["&-"] = wrapped(binaryBuiltin("-", 0, wrap), "(Self, Self) -> Self");
	}
	const reifiedType: ReifiedType = {
		functions: lookupForMap({
			"init(_builtinIntegerLiteral:)": wrapped(returnOnlyArgument, "(Self) -> Self"),
			"+": wrapped((scope, arg) => integerRangeCheck(scope, binary("+", arg(0, "lhs"), arg(1, "rhs"), scope), widerHigh, range), "(Self, Self) -> Self"),
			"-": wrapped((scope, arg, type, argTypes) => {
				if (argTypes.length === 1) {
					return integerRangeCheck(scope, unary("-", arg(0, "value"), scope), widerLow, range);
				}
				return integerRangeCheck(scope, binary("-", arg(0, "lhs"), arg(1, "rhs"), scope), widerLow, range);
			}, "(Self) -> Self"),
			"*": wrapped((scope, arg) => integerRangeCheck(scope, binary("*", arg(0, "lhs"), arg(1, "rhs"), scope), widerBoth, range), "(Self, Self) -> Self"),
			"/": wrapped((scope, arg) => binary("|", binary("/", arg(0, "lhs"), arg(1, "rhs"), scope), literal(0), scope), "(Self, Self) -> Self"),
			"%": wrapped(binaryBuiltin("%", 0), "(Self, Self) -> Self"),
			"<": wrapped(binaryBuiltin("<", 0), "(Self, Self) -> Bool"),
			">": wrapped(binaryBuiltin(">", 0), "(Self, Self) -> Bool"),
			"<=": wrapped(binaryBuiltin("<=", 0), "(Self, Self) -> Bool"),
			">=": wrapped(binaryBuiltin(">=", 0), "(Self, Self) -> Bool"),
			"&": wrapped(binaryBuiltin("&", 0), "(Self, Self) -> Self"),
			"|": wrapped(binaryBuiltin("|", 0), "(Self, Self) -> Self"),
			"^": wrapped(binaryBuiltin("^", 0), "(Self, Self) -> Self"),
			"==": wrapped(binaryBuiltin("===", 0), "(Self, Self) -> Bool"),
			"!=": wrapped(binaryBuiltin("!==", 0), "(Self, Self) -> Bool"),
			"+=": wrapped(updateBuiltin("+", 0), "(inout Self, Self) -> Void"),
			"-=": wrapped(updateBuiltin("-", 0), "(inout Self, Self) -> Void"),
			"*=": wrapped(updateBuiltin("*", 0), "(inout Self, Self) -> Void"),
			"...": wrapped((scope, arg) => {
				return tuple([arg(0, "start"), arg(1, "end")]);
			}, "(Self, Self) -> Self.Stride"),
			"hashValue": wrapped((scope, arg) => {
				return arg(0, "self");
			}, "(Self) -> Int"),
			"min": wrapped(() => {
				return literal(min);
			}, "(Type) -> Self"),
			"max": wrapped(() => {
				return literal(max);
			}, "(Type) -> Self"),
		} as FunctionMap),
		conformances: withPossibleRepresentations(applyDefaultConformances({
			Hashable: hashableConformance,
			Equatable: equatableConformance,
			Comparable: comparableConformance,
			BinaryInteger: binaryIntegerConformance,
			AdditiveArithmetic: additiveArithmeticConformance,
			Numeric: numericConformance,
			[integerTypeName]: integerConformance,
			SignedNumeric: signedNumericConformance,
			FixedWidthInteger: fixedWidthIntegerConformance,
			Strideable: strideableConformance,
			CustomStringConvertible: customStringConvertibleConformance,
			LosslessStringConvertible: {
				functions: {
					"init(_:)": wrapped((scope, arg) => {
						const input = read(arg(0, "description"), scope);
						const value = expressionLiteralValue(input);
						if (typeof value === "string") {
							const convertedValue = parseInt(value, 10);
							return literal(isNaN(convertedValue) ? null : convertedValue);
						}
						const result = uniqueName(scope, "integer");
						return statements([
							addVariable(scope, result, "Int", call(expr(identifier("parseInt")), [
								expr(input),
								literal(10),
							], ["String", "Int"], scope), DeclarationFlags.Const),
							returnStatement(
								read(conditional(
									binary("!==",
										lookup(result, scope),
										lookup(result, scope),
										scope,
									),
									literal(null),
									lookup(result, scope),
									scope,
								), scope),
							),
						]);
					}, "(String) -> Self?"),
				},
				requirements: [],
			},
		}, globalScope), PossibleRepresentation.Number),
		defaultValue() {
			return literal(0);
		},
		innerTypes: {
		},
	};
	return reifiedType;
}

function buildFloatingType(globalScope: Scope): ReifiedType {
	const reifiedType: ReifiedType = {
		functions: lookupForMap({
			"init(_:)": wrapped(returnOnlyArgument, "(Self) -> Self"),
			"init(_builtinIntegerLiteral:)": wrapped(returnOnlyArgument, "(Self) -> Self"),
			"init(_builtinFloatLiteral:)": wrapped(returnOnlyArgument, "(Self) -> Self"),
			"+": wrapped((scope, arg, type) => binary("+", arg(0, "lhs"), arg(1, "rhs"), scope), "(Self, Self) -> Self"),
			"-": wrapped((scope, arg, type, argTypes) => {
				if (argTypes.length === 1) {
					return unary("-", arg(0, "value"), scope);
				}
				return binary("-", arg(0, "lhs"), arg(1, "rhs"), scope);
			}, "(Self, Self) -> Self"),
			"*": wrapped((scope, arg, type) => binary("*", arg(0, "lhs"), arg(1, "rhs"), scope), "(Self, Self) -> Self"),
			"/": wrapped((scope, arg, type) => binary("/", arg(0, "lhs"), arg(1, "rhs"), scope), "(Self, Self) -> Self"),
			"%": wrapped(binaryBuiltin("%", 0), "(Self, Self) -> Self"),
			"<": wrapped(binaryBuiltin("<", 0), "(Self, Self) -> Bool"),
			">": wrapped(binaryBuiltin(">", 0), "(Self, Self) -> Bool"),
			"<=": wrapped(binaryBuiltin("<=", 0), "(Self, Self) -> Bool"),
			">=": wrapped(binaryBuiltin(">=", 0), "(Self, Self) -> Bool"),
			"&": wrapped(binaryBuiltin("&", 0), "(Self, Self) -> Self"),
			"|": wrapped(binaryBuiltin("|", 0), "(Self, Self) -> Self"),
			"^": wrapped(binaryBuiltin("^", 0), "(Self, Self) -> Self"),
			"+=": wrapped(updateBuiltin("+", 0), "(inout Self, Self) -> Void"),
			"-=": wrapped(updateBuiltin("-", 0), "(inout Self, Self) -> Void"),
			"*=": wrapped(updateBuiltin("*", 0), "(inout Self, Self) -> Void"),
			"/=": wrapped(updateBuiltin("/", 0), "(inout Self, Self) -> Void"),
			"hashValue": wrapped((scope, arg) => {
				// TODO: Find a good hash strategy for floating point types
				return binary("|", arg(0, "float"), literal(0), scope);
			}, "(Self) -> Int"),
		} as FunctionMap),
		conformances: withPossibleRepresentations(applyDefaultConformances({
			Equatable: {
				functions: {
					"==": wrapped(binaryBuiltin("===", 0), "(Self, Self) -> Bool"),
					"!=": wrapped(binaryBuiltin("!==", 0), "(Self, Self) -> Bool"),
				},
				requirements: [],
			},
			SignedNumeric: {
				functions: {
					"-": wrapped((scope, arg) => unary("-", arg(0, "value"), scope), "(Self) -> Self"),
				},
				requirements: [],
			},
			FloatingPoint: {
				functions: {
					"==": wrapped(binaryBuiltin("===", 0), "(Self, Self) -> Bool"),
					"!=": wrapped(binaryBuiltin("!==", 0), "(Self, Self) -> Bool"),
					"squareRoot()": (scope, arg, type) => {
						return callable(() => call(member("Math", "sqrt", scope), [arg(1, "value")], ["Double"], scope), "() -> Self");
					},
				},
				requirements: [],
			},
			LosslessStringConvertible: {
				functions: {
					"init(_:)": wrapped((scope, arg) => {
						const input = read(arg(0, "description"), scope);
						const value = expressionLiteralValue(input);
						if (typeof value === "string") {
							const convertedValue = Number(value);
							return literal(isNaN(convertedValue) ? null : convertedValue);
						}
						const result = uniqueName(scope, "number");
						return statements([
							addVariable(scope, result, "Int", call(expr(identifier("Number")), [
								expr(input),
							], ["String"], scope), DeclarationFlags.Const),
							returnStatement(
								read(conditional(
									binary("===",
										lookup(result, scope),
										lookup(result, scope),
										scope,
									),
									literal(null),
									lookup(result, scope),
									scope,
								), scope),
							),
						]);
					}, "(String) -> Self?"),
				},
				requirements: [],
			},
		}, globalScope), PossibleRepresentation.Number),
		defaultValue() {
			return literal(0);
		},
		innerTypes: {
			Type: cachedBuilder(() => primitive(PossibleRepresentation.Undefined, undefinedValue)),
		},
	};
	return reifiedType;
}

function resolveMethod(type: Value, name: string, scope: Scope, additionalArgs: Value[] = [], additionalTypes: Value[] = []) {
	const functionBuilder = typeFromValue(type, scope).functions(name);
	if (typeof functionBuilder !== "function") {
		throw new TypeError(`Could not find ${name} in ${stringifyValue(type)}`);
	}
	return functionBuilder(scope, (i) => {
		if (i === 0) {
			return type;
		}
		if (i > additionalArgs.length) {
			throw new RangeError(`Asked for argument ${i}, but only ${additionalArgs.length} are available (shifted for hidden protocol self value)`);
		}
		return additionalArgs[i - 1];
	}, name, concat([typeValue("Type")], additionalTypes));
}

interface NumericRange {
	min: Value;
	max: Value;
}

function rangeForNumericType(type: Value, scope: Scope): NumericRange {
	return {
		min: call(resolveMethod(type, "min", scope), [], [], scope),
		max: call(resolveMethod(type, "max", scope), [], [], scope),
	};
}

function possiblyGreaterThan(left: NumericRange, right: NumericRange, scope: Scope): boolean {
	const leftMax = expressionLiteralValue(read(left.max, scope));
	const rightMax = expressionLiteralValue(read(right.max, scope));
	return typeof leftMax !== "number" || typeof rightMax !== "number" || leftMax > rightMax;
}

function possiblyLessThan(left: NumericRange, right: NumericRange, scope: Scope): boolean {
	const leftMin = expressionLiteralValue(read(left.min, scope));
	const rightMin = expressionLiteralValue(read(right.min, scope));
	return typeof leftMin !== "number" || typeof rightMin !== "number" || leftMin < rightMin;
}

function integerRangeCheck(scope: Scope, value: Value, source: NumericRange, dest: NumericRange) {
	const requiresGreaterThanCheck = possiblyGreaterThan(source, dest, scope);
	const requiresLessThanCheck = possiblyLessThan(source, dest, scope);
	if (!requiresGreaterThanCheck && !requiresLessThanCheck) {
		return value;
	}
	const expression = read(value, scope);
	const constant = expressionLiteralValue(expression);
	const constantMin = expressionLiteralValue(read(dest.min, scope));
	const constantMax = expressionLiteralValue(read(dest.max, scope));
	if (typeof constant === "number" && typeof constantMin === "number" && typeof constantMax === "number" && constant >= constantMin && constant <= constantMax) {
		return expr(expression);
	}
	return reuse(expr(expression), scope, "integer", (reusableValue) => {
		let check;
		if (requiresGreaterThanCheck && requiresLessThanCheck) {
			check = logical(
				"||",
				binary("<", reusableValue, dest.min, scope),
				binary(">", reusableValue, dest.max, scope),
				scope,
			);
		} else if (requiresGreaterThanCheck) {
			check = binary(">", reusableValue, dest.max, scope);
		} else {
			check = binary("<", reusableValue, dest.min, scope);
		}
		const functionType: Function = { kind: "function", arguments: { kind: "tuple", types: [] }, return: voidType, throws: true, rethrows: false, attributes: [] };
		return conditional(
			check,
			call(functionValue("Swift.(swift-to-js).numericRangeFailed()", undefined, functionType), [], [], scope),
			reusableValue,
			scope,
		);
	});
}

function closedRangeIterate(range: Value, scope: Scope, body: (value: Value) => Statement): Statement[] {
	let end;
	const contents = [];
	const i = uniqueName(scope, "i");
	if (range.kind === "tuple" && range.values.length === 2) {
		contents.push(addVariable(scope, i, "Int", range.values[0]));
		const endExpression = read(range.values[1], scope);
		if (isPure(endExpression)) {
			end = expr(endExpression);
		} else {
			const endIdentifier = uniqueName(scope, "end");
			contents.push(addVariable(scope, endIdentifier, "Int", expr(endExpression)));
			end = lookup(endIdentifier, scope);
		}
	} else {
		addVariable(scope, i, "Int");
		const iExpression = read(lookup(i, scope), scope);
		if (iExpression.type !== "Identifier") {
			throw new TypeError(`Expected i to be an identifier, got a ${iExpression.type}`);
		}
		const endIdentifier = uniqueName(scope, "end");
		addVariable(scope, endIdentifier, "Int");
		const endIdentifierExpression = read(lookup(endIdentifier, scope), scope);
		if (endIdentifierExpression.type !== "Identifier") {
			throw new TypeError(`Expected end to be an identifier, got a ${endIdentifierExpression.type}`);
		}
		contents.push(variableDeclaration("const", [variableDeclarator(arrayPattern([iExpression, endIdentifierExpression]), read(range, scope))]));
		end = lookup(endIdentifier, scope);
	}
	const result = forStatement(
		contents.length === 1 ? contents[0] : undefined,
		read(binary("<=", lookup(i, scope), end, scope), scope),
		updateExpression("++", read(lookup(i, scope), scope)),
		body(lookup(i, scope)),
	);
	if (contents.length === 1) {
		return [result];
	} else {
		return concat(contents as Statement[], [result]);
	}
}

function toTypeTypeValue() {
	return typeTypeValue;
}

function adaptedMethod(otherMethodName: string, conformanceName: string | undefined, otherType: Function | string, adapter: (otherValue: Value, scope: Scope, type: Value, arg: ArgGetter) => Value, ourType: Function | string, typeArgCount: number = 1) {
	const ourFunctionType = parseFunctionType(ourType);
	return wrapped((scope, arg, type, typeValues, outerArg) => {
		const conformedType = typeof conformanceName !== "undefined" ? conformance(type, conformanceName, scope) : type;
		const types: Value[] = ourFunctionType.arguments.types.map((_, i) => outerArg(i));
		const typeTypes: Value[] = ourFunctionType.arguments.types.map(toTypeTypeValue);
		const otherMethod = call(functionValue(otherMethodName, conformedType, otherType), types, typeTypes, scope);
		return adapter(otherMethod, scope, type, arg);
	}, returnFunctionType(ourFunctionType));
}

function updateMethod(otherMethodName: string, conformanceName: string | undefined) {
	return adaptedMethod(otherMethodName, conformanceName, "(Self, Self) -> Self", (targetMethod, scope, type, arg) => {
		const lhs = arg(0, "lhs");
		const rhs = arg(1, "rhs");
		return set(lhs, call(targetMethod, [lhs, rhs], [type, type], scope), scope);
	}, "(Self.Type) -> (inout Self, Self) -> Void");
}

export function applyDefaultConformances(conformances: ProtocolConformanceMap, scope: Scope): ProtocolConformanceMap {
	const result: ProtocolConformanceMap = Object.create(null);
	for (const key of Object.keys(conformances)) {
		const reified = reifyType(key, scope);
		if (!Object.hasOwnProperty.call(reified.conformances, key)) {
			throw new TypeError(`${key} is not a protocol`);
		}
		const base = conformances[key];
		result[key] = {
			functions: {...reified.conformances[key].functions, ...base.functions},
			requirements: base.requirements,
		};
	}
	return result;
}

export function reuseArgs<T extends string[]>(arg: ArgGetter, offset: number, scope: Scope, names: T, callback: (...values: { [P in keyof T]: (ExpressionValue | MappedNameValue) }) => Value): Value {
	if (names.length === 0) {
		return (callback as () => Value)();
	}
	const [name, ...remaining] = names;
	if (names.length === 1) {
		return reuse(arg(offset, name), scope, name, callback as unknown as (value: ExpressionValue | MappedNameValue) => Value);
	}
	return reuse(arg(offset, name), scope, name, (value) => reuseArgs(arg, offset + 1, scope, remaining, (callback as unknown as (identifier: ExpressionValue | MappedNameValue, ...remaining: Array<ExpressionValue | MappedNameValue>) => Value).bind(null, value)));
}

const dummyType = typeValue({ kind: "name", name: "Dummy" });

export interface BuiltinConfiguration {
	checkedIntegers: boolean;
	simpleStrings: boolean;
}

function defaultTypes({ checkedIntegers, simpleStrings }: BuiltinConfiguration): TypeMap {
	const protocolTypes: TypeMap = Object.create(null);
	function addProtocol(name: string, functionMap: { [functionName: string]: FunctionBuilder } = Object.create(null), ...requirements: string[]) {
		const result = protocol(name, {
			[name]: {
				functions: functionMap,
				requirements,
			},
		});
		protocolTypes[name] = () => result;
	}

	addProtocol("Object", {
		":rep": abstractMethod,
	});
	addProtocol("Equatable", {
		"==": abstractMethod,
		"!=": adaptedMethod("==", "Equatable", "(Self, Self) -> Bool", (equalsMethod, scope, type, arg) => unary("!", call(equalsMethod, [arg(0, "lhs"), arg(1, "rhs")], [type, type], scope), scope), "(Self.Type) -> (Self, Self) -> Bool"),
		"~=": adaptedMethod("==", "Equatable", "(Self, Self) -> Bool", (equalsMethod, scope, type, arg) => call(equalsMethod, [arg(0, "lhs"), arg(1, "rhs")], [type, type], scope), "(Self.Type) -> (Self, Self) -> Bool"),
	});
	addProtocol("Comparable", {
		"<": abstractMethod,
		">": adaptedMethod("<", "Comparable", "(Self, Self) -> Bool", (lessThanMethod, scope, type, arg) => call(lessThanMethod, [arg(1, "rhs"), arg(0, "lhs")], [type, type], scope), "(Self.Type) -> (Self, Self) -> Bool"),
		"<=": adaptedMethod("<", "Comparable", "(Self, Self) -> Bool", (lessThanMethod, scope, type, arg) => unary("!", call(lessThanMethod, [arg(1, "rhs"), arg(0, "lhs")], [type, type], scope), scope), "(Self.Type) -> (Self, Self) -> Bool"),
		">=": adaptedMethod("<", "Comparable", "(Self, Self) -> Bool", (lessThanMethod, scope, type, arg) => unary("!", call(lessThanMethod, [arg(0, "lhs"), arg(1, "rhs")], [type, type], scope), scope), "(Self.Type) -> (Self, Self) -> Bool"),
		"...": wrapped((scope, arg) => tuple([arg(0, "minimum"), arg(1, "maximum")]), "(Self, Self) -> Range<Self>"),
	}, "Equatable");
	addProtocol("ExpressibleByNilLiteral", {
		"init(nilLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByBooleanLiteral", {
		"init(booleanLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByIntegerLiteral", {
		"init(integerLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByFloatLiteral", {
		"init(floatLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByUnicodeScalarLiteral", {
		"init(unicodeScalarLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByExtendedGraphemeClusterLiteral", {
		"init(extendedGraphemeClusterLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByStringLiteral", {
		"init(stringLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByArrayLiteral", {
		"init(arrayLiteral:)": abstractMethod,
	});
	addProtocol("ExpressibleByDictionaryLiteral", {
		"init(dictionaryLiteral:)": abstractMethod,
	});
	addProtocol("AdditiveArithmetic", {
		"zero": abstractMethod,
		"+": abstractMethod,
		"+=": updateMethod("+", "AdditiveArithmetic"),
		"-": abstractMethod,
		"-=": updateMethod("-", "AdditiveArithmetic"),
	}, "Equatable", "ExpressibleByIntegerLiteral");
	addProtocol("Numeric", {
		"init(exactly:)": abstractMethod,
		"*": abstractMethod,
		"*=": updateMethod("*", "Numeric"),
	}, "Equatable", "ExpressibleByIntegerLiteral", "AdditiveArithmetic");
	addProtocol("SignedNumeric", {
		"-": adaptedMethod("-", "Numeric", "(Self, Self) -> Self", (subtractMethod, scope, type, arg) => {
			// TODO: Call ExpressibleByIntegerLiteral
			return call(subtractMethod, [literal(0), arg(0, "self")], ["Int", type], scope);
		}, "(Self.Type) -> (Self) -> Self"),
		"negate": adaptedMethod("-", "SignedNumeric", "(Self, Self) -> Self", (negateMethod, scope, type, arg) => {
			return reuseArgs(arg, 0, scope, ["self"], (self) => {
				return set(self, call(negateMethod, [self], [type], scope), scope);
			});
		}, "(Self.Type) -> (inout Self) -> Void"),
	}, "Numeric");
	addProtocol("BinaryInteger", {
		"init(exactly:)": abstractMethod,
		"init(truncatingIfNeeded:)": abstractMethod,
		"init(clamping:)": abstractMethod,
		"/": abstractMethod,
		"/=": updateMethod("/", "BinaryInteger"),
		"%": abstractMethod,
		"%=": updateMethod("%", "BinaryInteger"),
		"+": abstractMethod,
		"+=": updateMethod("+", "BinaryInteger"),
		"-": abstractMethod,
		"-=": updateMethod("-", "BinaryInteger"),
		"*": abstractMethod,
		"*=": updateMethod("*", "BinaryInteger"),
		"~": abstractMethod,
		"&": abstractMethod,
		"&=": updateMethod("&", "BinaryInteger"),
		"|": abstractMethod,
		"|=": updateMethod("|", "BinaryInteger"),
		"^": abstractMethod,
		"^=": updateMethod("^", "BinaryInteger"),
		">>": abstractMethod,
		">>=": updateMethod(">>", "BinaryInteger"),
		"<<": abstractMethod,
		"<<=": updateMethod("<<", "BinaryInteger"),
		"quotientAndRemainder(dividingBy:)": abstractMethod,
		"signum": abstractMethod,
		"isSigned": abstractMethod,
	}, "CustomStringConvertible", "Hashable", "Numeric", "Strideable");
	addProtocol("SignedInteger", {
		"max": abstractMethod,
		"min": abstractMethod,
		"&+": abstractMethod,
		"&-": abstractMethod,
	}, "BinaryInteger", "SignedNumeric");
	addProtocol("UnsignedInteger", {
		max: abstractMethod,
		min: abstractMethod,
		magnitude: abstractMethod,
	}, "BinaryInteger", "SignedNumeric");
	addProtocol("FixedWidthInteger", {
		"max": abstractMethod,
		"min": abstractMethod,
		"init(_:radix:)": abstractMethod,
		"init(clamping:)": adaptedMethod("init(clamping:)", "BinaryInteger", "(T) -> T", (targetMethod, scope, type, arg) => {
			return call(targetMethod, [arg(0, "value")], ["T"], scope);
		}, "(Self.Type, T.Type) -> (T) -> Self"),
		"init(bigEndian:)": adaptedMethod("byteSwapped", "FixedWidthInteger", "(Self) -> Self", (targetMethod, scope, type, arg) => {
			return call(targetMethod, [arg(0, "value")], ["Self"], scope);
		}, "(Self.Type) -> (Self) -> Self"),
		"init(littleEndian:)": wrapped((scope, arg) => {
			return arg(0, "value");
		}, "(Self.Type) -> (Self) -> Self"),
		"bigEndian": abstractMethod,
		"byteSwapped": abstractMethod,
		"leadingZeroBitCount": abstractMethod,
		"littleEndian": abstractMethod,
		"nonzeroBitCount": abstractMethod,
		"bitWidth": abstractMethod,
		"addingReportingOverflow(_:)": abstractMethod,
		"dividedReportingOverflow(by:)": abstractMethod,
		"dividingFullWidth(_:)": abstractMethod,
		"multipliedFullWidth(by:)": abstractMethod,
		"multipliedReportingOverflow(by:)": abstractMethod,
		"remainderReportingOverflow(dividingBy:)": abstractMethod,
		"subtractingReportingOverflow(_:)": abstractMethod,
		"&*": abstractMethod,
		"&*=": updateMethod("&*", "FixedWidthInteger"),
		"&+": abstractMethod,
		"&+=": updateMethod("&+", "FixedWidthInteger"),
		"&-": abstractMethod,
		"&-=": updateMethod("&-", "FixedWidthInteger"),
		"&<<": abstractMethod,
		"&<<=": updateMethod("&<<", "FixedWidthInteger"),
		"&>>": abstractMethod,
		"&>>=": updateMethod("&>>", "FixedWidthInteger"),
	}, "BinaryInteger", "LosslessStringConvertible");
	addProtocol("FloatingPoint", {
		"init(_:)": abstractMethod,
		// properties
		"exponent": abstractMethod,
		"floatingPointClass": abstractMethod,
		"isCanonical": abstractMethod,
		"isFinite": abstractMethod,
		"isInfinite": abstractMethod,
		"isNaN": abstractMethod,
		"isSignalingNaN": abstractMethod,
		"isSubnormal": abstractMethod,
		"isZero": abstractMethod,
		"nextDown": abstractMethod,
		"nextUp": abstractMethod,
		"sign": abstractMethod,
		"significand": abstractMethod,
		"ulp": abstractMethod,
		// static properties
		"greatestFiniteMagnitude": abstractMethod,
		"infinity": abstractMethod,
		"leastNonzeroMagnitude": abstractMethod,
		"leastNormalMagnitude": abstractMethod,
		"nan": abstractMethod,
		"pi": abstractMethod,
		"radix": abstractMethod,
		"signalingNaN": abstractMethod,
		"ulpOfOne": abstractMethod,
		// methods
		"addProduct(_:_:)": abstractMethod,
		"addingProduct(_:_:)": abstractMethod,
		"formRemainder(dividingBy:)": abstractMethod,
		"formSquareRoot(_:)": abstractMethod,
		"formTruncatingRemainder(dividingBy:)": abstractMethod,
		"isEqual(to:)": abstractMethod,
		"isLess(than:)": abstractMethod,
		"isLessThanOrEqualTo(_:)": abstractMethod,
		"isTotallyOrdered(belowOrEqualTo:)": abstractMethod,
		"negate()": abstractMethod,
		"remainder(dividingBy:)": abstractMethod,
		"round()": abstractMethod,
		"round(_:)": abstractMethod,
		"rounded()": abstractMethod,
		"rounded(_:)": abstractMethod,
		"squareRoot()": abstractMethod,
		"truncatingRemainder(dividingBy:)": abstractMethod,
		// static methods
		"maximum(_:_:)": abstractMethod,
		"maximumMagnitude(_:_:)": abstractMethod,
		"minimum(_:_:)": abstractMethod,
		"minimumMagnitude(_:_:)": abstractMethod,
		// operators
		"*": abstractMethod,
		"*=": abstractMethod,
		"+": abstractMethod,
		"+=": abstractMethod,
		"-": abstractMethod,
		"-=": abstractMethod,
		"/": abstractMethod,
		"/=": abstractMethod,
		"==": abstractMethod,
	}, "Hashable", "SignedNumeric", "Strideable");
	addProtocol("BinaryFloatingPoint", {
		// initializers
		"init(_:)": abstractMethod,
		"init(exactly:)": abstractMethod,
		"init(sign:exponentBitPattern:significandBitPattern:)": abstractMethod,
		// properties
		"binade": abstractMethod,
		"exponentBitPattern": abstractMethod,
		"significandBitPattern": abstractMethod,
		"significandWidth": abstractMethod,
		// static properties
		"exponentBitCount": abstractMethod,
		"significandBitCount": abstractMethod,
	}, "ExpressibleByFloatLiteral", "FloatingPoint");
	addProtocol("IteratorProtocol", {
		"next()": abstractMethod,
	});
	addProtocol("Sequence", {
		"makeIterator()": abstractMethod,
		"contains(_:)": adaptedMethod("contains(where:)", "Sequence", "(Self, (Self.Element) -> Bool) -> Bool", (containsWhere, scope, type, arg) => {
			return call(
				containsWhere,
				[
					arg(0, "sequence"),
					callable((innerScope, innerArg) => {
						// TODO: Check if equal
						return literal(true);
					}, "(Self.Element) -> Bool"),
				],
				[
					"Self",
					"(Self.Element) -> Bool",
				],
				scope,
			);
		}, "(Self.Type) -> (Self, Self.Element) -> Bool"),
		"contains(where:)": abstractMethod,
		"first(where:)": abstractMethod,
		"min()": abstractMethod,
		"min(by:)": abstractMethod,
		"max()": abstractMethod,
		"max(by:)": abstractMethod,
		"dropFirst()": abstractMethod,
		"dropLast()": abstractMethod,
		"sorted()": abstractMethod,
		"sorted(by:)": abstractMethod,
		"reversed()": abstractMethod,
		"underestimatedCount": abstractMethod,
		"allSatisfy(_:)": abstractMethod,
		"reduce": abstractMethod,
	});
	addProtocol("Collection", {
		"Element": abstractMethod,
		"subscript(_:)": abstractMethod,
		"startIndex": abstractMethod,
		"endIndex": abstractMethod,
		"index(after:)": abstractMethod,
		"index(_:offsetBy:)": wrappedSelf((scope, arg, type, collection) => {
			const collectionType = conformance(type, "Collection", scope);
			const indexType = typeValue("Self.Index");
			return reuseArgs(arg, 0, scope, ["index", "distance"], (index, distance) => {
				const current = uniqueName(scope, "current");
				const i = uniqueName(scope, "i");
				return statements([
					addVariable(scope, current, "Self.Index", index),
					forStatement(
						addVariable(scope, i, "Int", literal(0)),
						read(binary("<", lookup(i, scope), distance, scope), scope),
						read(set(lookup(i, scope), literal(1), scope, "+="), scope),
						blockStatement(
							ignore(
								set(
									lookup(current, scope),
									call(
										resolveMethod(collectionType, "index(after:)", scope, [collection], [type]),
										[lookup(current, scope)],
										[indexType],
										scope,
									),
									scope,
								),
								scope,
							),
						),
					),
					returnStatement(read(lookup(current, scope), scope)),
				]);
			});
		}, "(Self, Self.Index, Int) -> Self.Index"),
		"index(_:offsetBy:limitedBy:)": wrappedSelf((scope, arg, type, collection) => {
			const collectionType = conformance(type, "Collection", scope);
			const indexType = typeValue("Self.Index");
			return reuseArgs(arg, 0, scope, ["index", "distance", "limit"], (index, distance, limit) => {
				const current = uniqueName(scope, "current");
				const i = uniqueName(scope, "i");
				return statements([
					addVariable(scope, current, "Self.Index", index),
					forStatement(
						addVariable(scope, i, "Int", literal(0)),
						read(logical("&&",
							binary("<", lookup(i, scope), distance, scope),
							call(
								resolveMethod(conformance(indexType, "Equatable", scope), "!=", scope),
								[lookup(current, scope), limit],
								[indexType, indexType],
								scope,
							),
							scope,
						), scope),
						read(set(lookup(i, scope), literal(1), scope, "+="), scope),
						blockStatement(
							ignore(
								set(
									lookup(current, scope),
									call(
										resolveMethod(collectionType, "index(after:)", scope, [collection], [type]),
										[lookup(current, scope)],
										[indexType],
										scope,
									),
									scope,
								),
								scope,
							),
						),
					),
					returnStatement(read(lookup(current, scope), scope)),
				]);
			});
		}, "(Self, Self.Index, Int, Self.Index) -> Self.Index"),
		"distance(from:to:)": wrappedSelf((scope, arg, type, collection) => {
			const collectionType = conformance(type, "Collection", scope);
			const indexType = typeValue("Self.Index");
			const indexTypeEquatable = conformance(indexType, "Equatable", scope);
			return reuseArgs(arg, 0, scope, ["start", "end"], (start, end) => {
				const current = uniqueName(scope, "current");
				const count = uniqueName(scope, "count");
				return statements([
					addVariable(scope, current, "Self.Index", start),
					addVariable(scope, count, "Int", literal(0)),
					whileStatement(
						read(call(
							resolveMethod(indexTypeEquatable, "!=", scope),
							[lookup(current, scope), end],
							[indexType, indexType],
							scope,
						), scope),
						blockStatement(concat(
							ignore(set(lookup(count, scope), literal(1), scope, "+="), scope),
							ignore(
								set(
									lookup(current, scope),
									call(
										resolveMethod(collectionType, "index(after:)", scope, [collection], [type]),
										[lookup(current, scope)],
										[indexType],
										scope,
									),
									scope,
								),
								scope,
							),
						)),
					),
					returnStatement(read(lookup(count, scope), scope)),
				]);
			});
		}, "(Self, Self.Index, Self.Index) -> Int"),
		"count": wrapped((scope, arg, type) => {
			return reuseArgs(arg, 0, scope, ["collection"], (collection) => {
				const collectionType = conformance(type, "Collection", scope);
				const indexType = typeValue("Self.Index");
				return call(
					call(
						functionValue("distance(from:to:)", collectionType, "(Type, Self) -> (Self.Index, Self.Index) -> Self.Index"),
						[type, collection],
						["Type", type],
						scope,
					),
					[
						call(resolveMethod(collectionType, "startIndex", scope), [collection], ["Self"], scope),
						call(resolveMethod(collectionType, "endIndex", scope), [collection], ["Self"], scope),
					],
					[
						indexType,
						indexType,
					],
					scope,
				);
			});
		}, "(Self) -> Int"),
		"formIndex(after:)": wrapped((scope, arg, type) => {
			const indexType = typeValue("Self.Index");
			const collectionType = conformance(type, "Collection", scope);
			return reuseArgs(arg, 0, scope, ["collection", "index"], (collection, index) => {
				return set(
					index,
					call(
						resolveMethod(collectionType, "index(after:)", scope, [collection], [type]),
						[index],
						[indexType],
						scope,
					),
					scope,
				);
			});
		}, "(Self, inout Self.Index) -> Void"),
		"formIndex(_:offsetBy:)": wrapped((scope, arg, type) => {
			const indexType = typeValue("Self.Index");
			const collectionType = conformance(type, "Collection", scope);
			return reuseArgs(arg, 0, scope, ["collection", "index", "distance"], (collection, index, distance) => {
				return set(
					index,
					call(
						resolveMethod(collectionType, "index(_:offsetBy:)", scope, [collection], [type]),
						[index, distance],
						[indexType, "Int"],
						scope,
					),
					scope,
				);
			});
		}, "(Self, inout Self.Index, Int) -> Void"),
		"formIndex(_:offsetBy:limitedBy:)": wrapped((scope, arg, type) => {
			const indexType = typeValue("Self.Index");
			const collectionType = conformance(type, "Collection", scope);
			return reuseArgs(arg, 0, scope, ["collection", "index", "distance", "limit"], (collection, index, distance, limit) => {
				return set(
					index,
					call(
						resolveMethod(collectionType, "index(_:offsetBy:limitedBy:)", scope, [collection], [type]),
						[index, distance, limit],
						[indexType, "Int", indexType],
						scope,
					),
					scope,
				);
			});
		}, "(Self, inout Self.Index, Int, Self.Index) -> Void"),
		"lazy": abstractMethod,
		"first": wrapped((scope, arg, type) => {
			return reuseArgs(arg, 0, scope, ["collection"], (collection) => {
				const collectionType = conformance(type, "Collection", scope);
				const elementType = typeValue("Self.Element");
				return conditional(
					call(resolveMethod(collectionType, "isEmpty", scope), [collection], ["Self"], scope),
					wrapInOptional(
						call(
							resolveMethod(collectionType, "subscript(_:)", scope),
							[collection, call(resolveMethod(collectionType, "startIndex", scope), [collection], ["Self"], scope)],
							["Self", "Self.Index"],
							scope,
						),
						elementType,
						scope,
					),
					emptyOptional(elementType, scope),
					scope,
				);
			});
		}, "(Self) -> Self.Element?"),
		"isEmpty": wrapped((scope, arg, type) => {
			return reuseArgs(arg, 0, scope, ["collection"], (collection) => {
				const collectionType = conformance(type, "Collection", scope);
				const indexType = typeValue("Self.Index");
				return call(
					resolveMethod(conformance(indexType, "Equatable", scope), "!=", scope),
					[
						call(resolveMethod(collectionType, "endIndex", scope), [collection], ["Self"], scope),
						call(resolveMethod(collectionType, "startIndex", scope), [collection], ["Self"], scope),
					],
					[
						indexType,
						indexType,
					],
					scope,
				);
			});
		}, "(Self) -> Bool"),
		"makeIterator()": abstractMethod,
		"prefix(upTo:)": abstractMethod,
		"prefix(through:)": wrappedSelf((scope, arg, type, self) => {
			const collectionType = conformance(type, "Collection", scope);
			const indexType = typeValue("Self.Index");
			return reuseArgs(arg, 0, scope, ["position"], (position) => {
				return call(
					call(
						functionValue("prefix(upTo:)", collectionType, "(Collection) -> (Self.Index) -> Self.SubSequence"),
						[type, self],
						["Type", type],
						scope,
					),
					[
						call(
							resolveMethod(collectionType, "index(after:)", scope, [self], [type]),
							[position],
							[indexType],
							scope,
						),
					],
					[
						indexType,
					],
					scope,
				);
			});
		}, "(Self, Self.Index) -> Self.SubSequence"),
	}, "Sequence");
	addProtocol("BidirectionalCollection", {
		"index(before:)": abstractMethod,
		"formIndex(before:)": wrapped((scope, arg, type) => {
			const indexType = typeValue("Self.Index");
			const collectionType = conformance(type, "BidirectionalCollection", scope);
			return reuseArgs(arg, 0, scope, ["collection", "index"], (collection, index) => {
				return set(
					index,
					call(
						resolveMethod(collectionType, "index(before:)", scope, [collection], [type]),
						[index],
						[indexType],
						scope,
					),
					scope,
				);
			});
		}, "(Self, inout Self.Index) -> Void"),
	}, "Collection");
	addProtocol("Strideable", {
		"+": abstractMethod,
		"+=": updateMethod("+", "Strideable"),
		"-": abstractMethod,
		"-=": updateMethod("-", "Strideable"),
		"==": abstractMethod,
		"...": abstractMethod,
		"distance(to:)": adaptedMethod("-", "Strideable", "(Self, Self) -> Self", (subtractMethod, scope, type, arg) => {
			return call(subtractMethod, [arg(1, "rhs"), arg(0, "lhs")], [type, type], scope);
		}, "(Self.Type) -> (Self, Self) -> Bool"),
		"advanced(by:)": adaptedMethod("+", "Strideable", "(Self, Self) -> Self", (addMethod, scope, type, arg) => {
			return call(addMethod, [arg(0, "lhs"), arg(1, "rhs")], [type, type], scope);
		}, "(Self.Type) -> (Self, Self) -> Bool"),
	}, "Comparable");
	addProtocol("Hashable", {
		"hashValue": abstractMethod,
		"hash(into:)": adaptedMethod("hashValue", "Hashable", "(Self) -> Int", (hashValueMethod, scope, type, arg) => {
			return reuse(call(hashValueMethod, [arg(0, "self")], ["Self"], scope), scope, "hashValue", (hashValue) => {
				const hasherType = typeValue("Hasher");
				const combine = call(functionValue("combine()", hasherType, "(Type) -> (inout Hasher, Int) -> Void"), [hasherType], [typeTypeValue], scope);
				return call(combine, [arg(1, "hasher"), hashValue], ["Hasher", "Int"], scope);
			});
		}, "(Self.Type) -> (Self, inout Hasher) -> Bool"),
	}, "Equatable");
	addProtocol("CustomStringConvertible", {
		description: abstractMethod,
	});
	addProtocol("LosslessStringConvertible", {
		"init(_:)": abstractMethod,
	}, "CustomStringConvertible");

	const BoolType = cachedBuilder(BoolBuiltin);

	return {
		...protocolTypes,
		Bool: BoolType,
		Int1: BoolType,
		UInt: cachedBuilder((globalScope) => buildIntegerType(globalScope, 0, 4294967295, 32, checkedIntegers, (value, scope) => binary(">>>", value, literal(0), scope))),
		Int: cachedBuilder((globalScope) => buildIntegerType(globalScope, -2147483648, 2147483647, 32, checkedIntegers, (value, scope) => binary("|", value, literal(0), scope))),
		UInt8: cachedBuilder((globalScope) => buildIntegerType(globalScope, 0, 255, 8, checkedIntegers, (value, scope) => binary("&", value, literal(0xFF), scope))),
		Int8: cachedBuilder((globalScope) => buildIntegerType(globalScope, -128, 127, 8, checkedIntegers, (value, scope) => binary(">>", binary("<<", value, literal(24), scope), literal(24), scope))),
		UInt16: cachedBuilder((globalScope) => buildIntegerType(globalScope, 0, 65535, 16, checkedIntegers, (value, scope) => binary("&", value, literal(0xFFFF), scope))),
		Int16: cachedBuilder((globalScope) => buildIntegerType(globalScope, -32768, 32767, 16, checkedIntegers, (value, scope) => binary(">>", binary("<<", value, literal(16), scope), literal(16), scope))),
		UInt32: cachedBuilder((globalScope) => buildIntegerType(globalScope, 0, 4294967295, 32, checkedIntegers, (value, scope) => binary(">>>", value, literal(0), scope))),
		Int32: cachedBuilder((globalScope) => buildIntegerType(globalScope, -2147483648, 2147483647, 32, checkedIntegers, (value, scope) => binary("|", value, literal(0), scope))),
		UInt64: cachedBuilder((globalScope) => buildIntegerType(globalScope, 0, Number.MAX_SAFE_INTEGER, 53, checkedIntegers, (value) => value)), // 53-bit integers
		Int64: cachedBuilder((globalScope) => buildIntegerType(globalScope, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 53, checkedIntegers, (value) => value)), // 53-bit integers
		Float: cachedBuilder(buildFloatingType),
		Double: cachedBuilder(buildFloatingType),
		String: StringBuiltin(simpleStrings),
		StaticString: cachedBuilder(() => primitive(PossibleRepresentation.String, literal(""), {
		})),
		DefaultStringInterpolation: cachedBuilder((globalScope) => primitive(PossibleRepresentation.String, literal(""), {
			"init(literalCapacity:interpolationCount:)": wrapped(() => literal(""), `(Int, Int) -> Self`),
			"appendLiteral": wrapped((scope, arg, type, argTypes, outerArg) => {
				const interpolationArg = outerArg(0, "interpolation");
				const literalArg = arg(0, "literal");
				if (literalArg.kind === "expression" && literalArg.expression.type === "StringLiteral" && literalArg.expression.value === "") {
					return statements([]);
				} else {
					return set(interpolationArg, literalArg, scope, "+=");
				}
			}, `(String) -> Void`),
			"appendInterpolation": wrapped((scope, arg, type, argTypes, outerArg) => {
				return set(outerArg(1, "interpolation"), arg(0, "value"), scope, "+=");
			}, `(String) -> Void`),
		})),
		Character: cachedBuilder((globalScope) => {
			return primitive(PossibleRepresentation.String, literal(""), {
				"init(_:)": wrapped((scope, arg) => {
					return arg(0, "character");
				}, "(String) -> Character"),
				"==": wrapped(binaryBuiltin("===", 0), "(Character, Character) -> Bool"),
				"!=": wrapped(binaryBuiltin("!==", 0), "(Character, Character) -> Bool"),
				"<": wrapped(binaryBuiltin("<", 0), "(Character, Character) -> Bool"),
				"<=": wrapped(binaryBuiltin("<=", 0), "(Character, Character) -> Bool"),
				">": wrapped(binaryBuiltin(">", 0), "(Character, Character) -> Bool"),
				">=": wrapped(binaryBuiltin(">=", 0), "(Character, Character) -> Bool"),
			});
		}),
		Optional: OptionalBuiltin,
		// Should be represented as an empty struct, but we currently
		_OptionalNilComparisonType: cachedBuilder(() => primitive(PossibleRepresentation.Null, literal(null), {
			"init(nilLiteral:)": wrapped((scope, arg, type) => literal(null), "() -> _OptionalNilComparisonType"),
		}, Object.create(null), {
			Type: cachedBuilder(() => primitive(PossibleRepresentation.Undefined, undefinedValue)),
		})),
		Array: ArrayBuiltin,
		IndexingIterator: (globalScope, typeParameters) => {
			const [ elementsType ] = typeParameters("Elements");
			return {
				functions: lookupForMap({
					"init(_elements:)": wrapped((scope, arg) => {
						const collectionConformance = conformance(elementsType, "Collection", scope);
						const startIndexFunction = call(functionValue("startIndex", collectionConformance, "(Type) -> (Self) -> Self.Index"), [elementsType], ["Type"], scope);
						return transform(arg(0, "elements"), scope, (elementsValue) => {
							return expr(objectExpression([
								objectProperty(identifier("elements"), elementsValue),
								objectProperty(identifier("position"), read(call(startIndexFunction, [expr(elementsValue)], [elementsType], scope), scope)),
							]));
						});
					}, "(Self.Elements) -> Self"),
					"init(_elements:_position:)": wrapped((scope, arg) => {
						return transform(arg(0, "elements"), scope, (elementsValue) => {
							return transform(arg(1, "position"), scope, (positionValue) => {
								return expr(objectExpression([
									objectProperty(identifier("elements"), elementsValue),
									objectProperty(identifier("position"), positionValue),
								]));
							});
						});
					}, "(Self.Elements, Self.Elements.Index) -> Self"),
				}),
				conformances: withPossibleRepresentations(applyDefaultConformances({
					IteratorProtocol: {
						functions: {
							"next()": wrapped((scope, arg) => {
								return reuse(arg(0, "iterator"), scope, "iterator", (iterator) => {
									const collectionConformance = conformance(elementsType, "Collection", scope);
									const elementTypeFunction = call(functionValue("Element", collectionConformance, "(Type) -> () -> Type"), [elementsType], ["Type"], scope);
									const elementType = call(elementTypeFunction, [], [], scope);
									const endIndexFunction = call(functionValue("endIndex", collectionConformance, "(Type) -> (Self) -> Self.Index"), [elementsType], ["Type"], scope);
									return conditional(
										binary("===",
											member(iterator, "position", scope),
											call(endIndexFunction, [member(iterator, "elements", scope)], [elementsType], scope),
											scope,
										),
										emptyOptional(elementType, scope),
										wrapInOptional(member(member(iterator, "elements", scope), expr(updateExpression("++", read(member(iterator, "position", scope), scope))), scope), elementType, scope),
										scope,
									);
								});
							}, "(inout Self) -> Self.Element?"),
						},
						requirements: [],
					},
				}, globalScope), PossibleRepresentation.Object),
				defaultValue() {
					return tuple([]);
				},
				copy(value, scope) {
					return call(member(expr(identifier("Object")), "assign", scope), [literal({}), value], ["Self", "Self"], scope);
				},
				innerTypes: {},
			};
		},
		Dictionary: (globalScope, typeParameters) => {
			const [ keyType, valueType ] = typeParameters("Key", "Value");
			if (keyType.kind !== "type") {
				// TODO: Support runtime types
				throw new TypeError(`Runtime types are not supported as K in [K: V]`);
			}
			if (valueType.kind !== "type") {
				// TODO: Support runtime types
				throw new TypeError(`Runtime types are not supported as V in [K: V]`);
			}
			const keysType = typeValue({ kind: "array", type: keyType.type });
			const reifiedValueType = typeFromValue(valueType, globalScope);
			function objectDictionaryImplementation(converter?: Value): ReifiedType {
				const reifiedKeysType = typeFromValue(keysType, globalScope);
				return {
					functions: lookupForMap({
						"subscript(_:)": wrapped((scope, arg, type) => {
							return reuseArgs(arg, 0, scope, ["dict", "index"], (dict, index) => {
								return conditional(
									call(
										member(
											member(
												expr(identifier("Object")),
												"hasOwnProperty",
												scope,
											),
											"call",
											scope,
										),
										[dict, index],
										["Any", "String"],
										scope,
									),
									wrapInOptional(copy(member(dict, index, scope), valueType), valueType, scope),
									emptyOptional(valueType, scope),
									scope,
								);
							});
						}, "(Self, Self.Key) -> Self.Value?"),
						"subscript(_:)_set": wrapped((scope, arg, type) => {
							const dict = arg(0, "dict");
							const index = arg(1, "index");
							const valueExpression = read(arg(2, "value"), scope);
							const valueIsOptional = hasRepresentation(valueType, PossibleRepresentation.Null, scope);
							if (valueIsOptional.kind === "expression" && valueIsOptional.expression.type === "BooleanLiteral") {
								if (valueIsOptional.expression.value) {
									if (valueExpression.type === "ArrayExpression" && valueExpression.elements.length === 0) {
										return unary("delete", member(dict, index, scope), scope);
									}
								} else {
									if (valueExpression.type === "NullLiteral") {
										return unary("delete", member(dict, index, scope), scope);
									}
								}
							}
							if (isLiteral(valueExpression) || valueExpression.type === "ArrayExpression" || valueExpression.type === "ObjectExpression") {
								return set(member(dict, index, scope), expr(valueExpression), scope);
							}
							return reuse(expr(valueExpression), scope, "value", (reusableValue) => {
								return conditional(
									optionalIsSome(reusableValue, valueType, scope),
									set(member(dict, index, scope), copy(unwrapOptional(reusableValue, valueType, scope), valueType), scope),
									unary("delete", member(dict, index, scope), scope),
									scope,
								);
							});
						}, "(Self, Self.Key, Self.Value?) -> Void"),
						"count": wrapped((scope, arg) => {
							return member(call(member("Object", "keys", scope), [arg(0, "self")], ["[String]"], scope), "length", scope);
						}, "(Self) -> Int"),
						"keys": wrapped((scope, arg) => {
							return call(member("Object", "keys", scope), [arg(0, "self")], ["[String]"], scope);
						}, "(Self) -> Self.Keys"),
					} as FunctionMap),
					conformances: withPossibleRepresentations(applyDefaultConformances({
						// TODO: Implement Equatable
						Equatable: {
							functions: {
								"==": wrapped((innerScope, arg) => {
									return reuseArgs(arg, 0, innerScope, ["lhs", "rhs"], (lhs, rhs) => {
										const key = uniqueName(innerScope, "key");
										const equal = uniqueName(innerScope, "equal");
										return statements([
											addVariable(innerScope, equal, "Bool", literal(true)),
											addVariable(innerScope, key, "T"),
											forInStatement(
												read(lookup(key, innerScope), innerScope) as Node as Identifier,
												read(lhs, innerScope),
												blockStatement([
													ifStatement(
														read(
															logical(
																"||",
																unary("!", call(member(member("Object", "hasOwnProperty", innerScope), "call", innerScope), [rhs, lookup(key, innerScope)], ["Self", "String"], innerScope), innerScope),
																call(
																	call(
																		functionValue("!=", conformance(valueType, "Equatable", innerScope), "(Type) -> (Self, Self) -> Bool"),
																		[valueType],
																		[typeTypeValue],
																		innerScope,
																	),
																	[
																		member(lhs, lookup(key, innerScope), innerScope),
																		member(rhs, lookup(key, innerScope), innerScope),
																	],
																	[
																		valueType,
																		valueType,
																	],
																	innerScope,
																),
																innerScope,
															),
															innerScope,
														),
														blockStatement(concat(
															ignore(set(lookup(equal, innerScope), literal(false), innerScope), innerScope),
															[breakStatement()],
														)),
													),
												]),
											),
											ifStatement(
												read(lookup(equal, innerScope), innerScope),
												forInStatement(
													read(lookup(key, innerScope), innerScope) as Node as Identifier,
													read(rhs, innerScope),
													blockStatement([
														ifStatement(
															read(
																unary("!", call(member(member("Object", "hasOwnProperty", innerScope), "call", innerScope), [lhs, lookup(key, innerScope)], ["Self", "String"], innerScope), innerScope),
																innerScope,
															),
															blockStatement(concat(
																ignore(set(lookup(equal, innerScope), literal(false), innerScope), innerScope),
																[breakStatement()],
															)),
														),
													]),
												),
											),
											returnStatement(read(lookup(equal, innerScope), innerScope)),
										]);
									});
								}, "(Self, Self) -> Bool"),
							},
							requirements: [],
						},
					}, globalScope), PossibleRepresentation.Object),
					defaultValue() {
						return literal({});
					},
					copy(value, scope) {
						const expression = read(value, scope);
						if (expressionSkipsCopy(expression)) {
							return expr(expression);
						}
						if (reifiedValueType.copy) {
							throw new TypeError(`Copying dictionaries with non-simple values is not yet implemented!`);
						}
						return call(
							member("Object", "assign", scope),
							[literal({}), expr(expression)],
							["Any", "Any"],
							scope,
						);
					},
					innerTypes: {
						Keys() {
							return inheritLayout(reifiedKeysType, {
								count: readLengthField,
								isEmpty: isEmptyFromLength,
								startIndex: startIndexOfZero,
								endIndex: readLengthField,
								first: wrapped((scope, arg) => {
									return reuseArgs(arg, 0, scope, ["keys"], (keys) => {
										const stringKey = member(keys, 0, scope);
										const convertedKey = typeof converter !== "undefined" ? call(converter, [stringKey], ["String"], scope) : stringKey;
										return conditional(
											member(keys, "length", scope),
											wrapInOptional(convertedKey, keyType, scope),
											emptyOptional(keyType, scope),
											scope,
										);
									});
								}, "(Self) -> Self.Wrapped?"),
								underestimatedCount: wrapped((scope, arg) => {
									return member(arg(0, "self"), "length", scope);
								}, "(Self) -> Int"),
							});
						},
					},
				};
			}
			const representationsValue = expressionLiteralValue(read(representationsForTypeValue(keyType, globalScope), globalScope));
			switch (representationsValue) {
				case PossibleRepresentation.String:
					return objectDictionaryImplementation();
				case PossibleRepresentation.Boolean:
					return objectDictionaryImplementation(expr(identifier("Boolean")));
				case PossibleRepresentation.Number:
					return objectDictionaryImplementation(expr(identifier("Number")));
				default:
					throw new Error(`No dictionary implementation for keys of type ${stringifyValue(keyType)}`);
			}
		},
		Error: cachedBuilder((globalScope) => primitive(PossibleRepresentation.Number, literal(0), {
			hashValue(scope, arg) {
				return arg(0, "self");
			},
		})),
		ClosedRange: cachedBuilder((globalScope) => primitive(PossibleRepresentation.Array, tuple([literal(0), literal(0)]), {
		}, applyDefaultConformances({
			// TODO: Implement Equatable
			Equatable: {
				functions: {
					"==": wrapped(binaryBuiltin("===", 0), "(Self, Self) -> Bool"),
				},
				requirements: [],
			},
			Sequence: {
				functions: {
					reduce: (scope, arg, type) => {
						const range = arg(2, "range");
						return callable((innerScope, innerArg) => {
							const result = uniqueName(innerScope, "result");
							const initialResult = innerArg(0, "initialResult");
							const next = innerArg(1, "next");
							return statements(concat(
								[addVariable(innerScope, result, dummyType, initialResult)],
								closedRangeIterate(range, innerScope, (i) => blockStatement(
									ignore(set(lookup(result, scope), call(next, [lookup(result, scope), i], [dummyType, dummyType], scope), scope), scope),
								)),
								[returnStatement(read(lookup(result, scope), scope))],
							));
						}, "(Result, (Result, Self.Element) -> Result) -> Result");
					},
				},
				requirements: [],
			},
			Collection: {
				functions: {
					map: (scope, arg, type) => {
						const range = arg(2, "range");
						return callable((innerScope, innerArg) => {
							const mapped = uniqueName(innerScope, "mapped");
							const callback = innerArg(0, "callback");
							return statements(concat(
								[addVariable(innerScope, mapped, dummyType, literal([]), DeclarationFlags.Const)],
								closedRangeIterate(range, innerScope, (i) => blockStatement(
									ignore(call(
										member(lookup(mapped, scope), "push", scope),
										[call(callback, [i], [dummyType], scope)],
										[dummyType],
										scope,
									), scope),
								)),
								[returnStatement(read(lookup(mapped, scope), scope))],
							));
						}, "((Self) -> V) -> [V]");
					},
				},
				requirements: [],
			},
		}, globalScope))),
		Hasher: cachedBuilder((globalScope) => primitive(PossibleRepresentation.Array, array([literal(0)], globalScope), {
			"combine()": wrapped((scope, arg) => {
				return reuseArgs(arg, 0, scope, ["hasher"], (hasher) => {
					return set(
						member(hasher, 0, scope),
						binary("-",
							binary("+",
								binary("<<",
									member(hasher, 0, scope),
									literal(5),
									scope,
								),
								arg(1, "value"), // TODO: Call hashValue
								scope,
							),
							member(hasher, 0, scope),
							scope,
						),
						scope,
					);
				});
			}, "(inout Hasher, Int) -> Void"),
			"finalize()": wrapped((scope, arg) => {
				return binary("|", member(arg(0, "hasher"), 0, scope), literal(0), scope);
			}, "(Hasher) -> Int"),
		})),
	};
}

function throwHelper(type: "Error" | "TypeError" | "RangeError", text: string) {
	return noinline((scope, arg) => statements([throwStatement(newExpression(identifier(type), [literal(text).expression]))]), "() throws -> Void");
}

export const functions: FunctionMap = {
	"Swift.(swift-to-js).numericRangeFailed()": throwHelper("RangeError", "Not enough bits to represent the given value"),
	"Swift.(swift-to-js).forceUnwrapFailed()": throwHelper("TypeError", "Unexpectedly found nil while unwrapping an Optional value"),
	"Swift.(swift-to-js).arrayBoundsFailed()": throwHelper("RangeError", "Array index out of range"),
	"Swift.(swift-to-js).stringBoundsFailed()": throwHelper("RangeError", "String index out of range"),
	"Swift.(swift-to-js).notImplemented()": throwHelper("Error", "Not implemented!"),
	"Swift.(swift-to-js).arrayInsertAt()": noinline((scope, arg) => {
		return statements([
			ifStatement(
				read(logical("||",
					binary(">",
						arg(2, "i"),
						member(arg(0, "array"), "length", scope),
						scope,
					),
					binary("<",
						arg(2, "i"),
						literal(0),
						scope,
					),
					scope,
				), scope),
				blockStatement(
					ignore(arrayBoundsFailed(scope), scope),
				),
				blockStatement(
					ignore(call(
						// TODO: Remove use of splice, since it's slow
						member(arg(0, "array"), "splice", scope),
						[
							arg(2, "i"),
							literal(0),
							arg(1, "newElement"),
						],
						[
							"Int",
							"Int",
							"Any",
						],
						scope,
					), scope),
				),
			),
		]);
	}, "(inout Self, Self.Element, Int) -> Void"),
	"Swift.(swift-to-js).arrayRemoveAt()": noinline((scope, arg) => {
		return statements([
			ifStatement(
				read(logical("||",
					binary(">=",
						arg(1, "i"),
						member(arg(0, "array"), "length", scope),
						scope,
					),
					binary("<",
						arg(1, "i"),
						literal(0),
						scope,
					),
					scope,
				), scope),
				blockStatement(
					ignore(arrayBoundsFailed(scope), scope),
				),
			),
			// TODO: Remove use of splice, since it's slow
			returnStatement(
				read(member(
					call(
						member(arg(0, "array"), "splice", scope),
						[
							arg(1, "i"),
							literal(1),
						],
						[
							"Int",
							"Int",
						],
						scope,
					),
					literal(0),
					scope,
				), scope),
			),
		]);
	}, "(inout Self, Int) -> Self.Element"),
	"Sequence.reduce": (scope, arg, type) => callable((innerScope, innerArg) => {
		return call(expr(identifier("Sequence$reduce")), [arg(0), arg(1)], [dummyType, dummyType], scope);
	}, "(Result, (Result, Self.Element) -> Result) -> Result"),
	"??": (scope, arg, type) => {
		const typeArg = arg(0, "type");
		if (typeArg.kind !== "type") {
			throw new TypeError(`Expected a type, got a ${typeArg.kind}`);
		}
		return reuseArgs(arg, 1, scope, ["lhs"], (lhs) => {
			return conditional(
				optionalIsSome(lhs, typeArg, scope),
				unwrapOptional(lhs, typeArg, scope),
				call(arg(2, "rhs"), [], [], scope),
				scope,
			);
		});
	},
	"~=": (scope, arg) => {
		const T = arg(0, "T");
		const result = call(functionValue("~=", conformance(T, "Equatable", scope), "(T.Type) -> (T, T) -> Bool"), [T], [dummyType], scope);
		return call(result, [arg(1, "pattern"), arg(2, "value")], [T, T], scope);
	},
	"print(_:separator:terminator:)": (scope, arg, type) => call(member("console", "log", scope), [arg(0, "items")], [dummyType], scope),
	"precondition(_:_:file:line:)": (scope, arg, type) => statements([
		ifStatement(
			read(unary("!", call(arg(0, "condition"), [], [], scope), scope), scope),
			blockStatement([
				expressionStatement(identifier("debugger")),
				throwStatement(newExpression(identifier("Error"), [
					read(call(arg(1, "message"), [], [], scope), scope),
					read(arg(2, "file"), scope),
					read(arg(3, "line"), scope),
				])),
			]),
		),
	]),
	"preconditionFailed(_:file:line:)": (scope, arg, type) => statements([
		expressionStatement(identifier("debugger")),
		throwStatement(newExpression(identifier("Error"), [
			read(call(arg(0, "message"), [], [], scope), scope),
			read(arg(1, "file"), scope),
			read(arg(2, "line"), scope),
		])),
	]),
	"fatalError(_:file:line:)": (scope, arg, type) => statements([
		expressionStatement(identifier("debugger")),
		throwStatement(newExpression(identifier("Error"), [
			read(call(arg(0, "message"), [], [], scope), scope),
			read(arg(1, "file"), scope),
			read(arg(2, "line"), scope),
		])),
	]),
	"isKnownUniquelyReferenced": () => literal(false),
	"withExtendedLifetime": (scope, arg) => call(arg(3, "body"), [
		arg(2, "preserve"),
	], ["Any"], scope),
	"withUnsafePointer": unavailableFunction,
	"withUnsafeMutablePointer": unavailableFunction,
	"withUnsafeBytes": unavailableFunction,
	"withUnsafeMutableBytes": unavailableFunction,
	"unsafeDowncast(to:)": unavailableFunction,
	"unsafeBitCast(to:)": unavailableFunction,
	"withVaList": unavailableFunction,
	"getVaList": unavailableFunction,
	"swap": (scope, arg) => {
		const type = arg(0, "type");
		const a = arg(1, "a");
		const b = arg(2, "b");
		const temp = uniqueName(scope, "temp");
		return statements(concat(
			[addVariable(scope, temp, type, a, DeclarationFlags.Const)],
			ignore(set(a, b, scope), scope),
			ignore(set(b, lookup(temp, scope), scope), scope),
		));
	},
};

export function newScopeWithBuiltins(): Scope {
	return {
		name: "global",
		declarations: Object.create(null),
		types: defaultTypes({
			checkedIntegers: false,
			simpleStrings: true,
		}),
		functions: Object.assign(Object.create(null), functions),
		functionUsage: Object.create(null),
		mapping: Object.create(null),
		parent: undefined,
	};
}
