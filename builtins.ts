import { arrayExpression, assignmentExpression, binaryExpression, blockStatement, booleanLiteral, callExpression, Expression, functionExpression, identifier, Identifier, logicalExpression, memberExpression, newExpression, NullLiteral, nullLiteral, numericLiteral, returnStatement, stringLiteral, thisExpression, unaryExpression, variableDeclaration, variableDeclarator } from "babel-types";
import { FunctionBuilder, returnType, wrapped } from "./functions";
import { emitScope, mangleName, newScope, rootScope, Scope } from "./scope";
import { parse as parseType, Type } from "./types";
import { ArgGetter, call, callable, expr, ExpressionValue, functionValue, read, StructField, structField, tuple, unbox, undefinedValue, Value, variable } from "./values";

function returnOnlyArgument(scope: Scope, arg: ArgGetter): Value {
	return arg(0);
}

function returnThis(scope: Scope, arg: ArgGetter): Value {
	return arg("this");
}

function returnTodo(scope: Scope, arg: ArgGetter, type: Type, name: string): Value {
	console.log(name);
	return call(expr(mangleName("todo_missing_builtin$" + name)), undefinedValue, [], scope);
}

function returnLength(scope: Scope, arg: ArgGetter): Value {
	const arg0 = arg(0);
	return arg0.kind === "direct" ? variable(read(arg0, scope)) : expr(read(arg0, scope));
}

function binaryBuiltin(operator: "+" | "-" | "*" | "/" | "%" | "<" | ">" | "<=" | ">=" | "&" | "|" | "^" | "==" | "===" | "!=" | "!==") {
	return wrapped((scope: Scope, arg: ArgGetter) => expr(binaryExpression(operator, read(arg(0), scope), read(arg(1), scope))));
}

function assignmentBuiltin(operator: "=" | "+=" | "-=" | "*=" | "/=" | "|=" | "&=") {
	return wrapped((scope: Scope, arg: ArgGetter) => expr(assignmentExpression(operator, read(unbox(arg(0), scope), scope), read(arg(1), scope))));
}

export const structTypes: { [name: string]: StructField[] } = {
	"String": [
		structField("unicodeScalars", "UTF32View", (value, scope) => call(expr(memberExpression(identifier("Array"), identifier("from"))), undefinedValue, [value], scope)),
		structField("utf16", "UTF16View", (value) => value),
		structField("utf8", "UTF8View", (value, scope) => call(expr(memberExpression(newExpression(identifier("TextEncoder"), [stringLiteral("utf-8")]), identifier("encode"))), undefinedValue, [value], scope)),
	],
	"UTF32View": [
		structField("count", "Int", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
		structField("startIndex", "Int64", (value: Value, scope: Scope) => expr(numericLiteral(0))),
		structField("endIndex", "Int64", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
	],
	"UTF16View": [
		structField("count", "Int", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
		structField("startIndex", "Int64", (value: Value, scope: Scope) => expr(numericLiteral(0))),
		structField("endIndex", "Int64", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
	],
	"UTF8View": [
		structField("count", "Int", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
		structField("startIndex", "Int64", (value: Value, scope: Scope) => expr(numericLiteral(0))),
		structField("endIndex", "Int64", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
	],
	"Collection": [
		structField("count", "Int", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
	],
	"Array": [
		structField("count", "Int", (value: Value, scope: Scope) => expr(memberExpression(read(value, scope), identifier("length")))),
	],
};

export const defaultValues: { [name: string]: Expression } = {
	"Bool": booleanLiteral(false),
	"Int": numericLiteral(0),
	"Int64": numericLiteral(0),
	"Float": numericLiteral(0),
	"Double": numericLiteral(0),
	"String": stringLiteral(""),
	"UTF16View": stringLiteral(""),
	"Optional": nullLiteral(),
	"Array": arrayExpression([]),
};

export const functions: { [name: string]: FunctionBuilder } = {
	"Swift.(file).Int.init(_builtinIntegerLiteral:)": wrapped(returnOnlyArgument),
	"Swift.(file).Int.+": binaryBuiltin("+"),
	"Swift.(file).Int.-": binaryBuiltin("-"),
	"Swift.(file).Int.*": binaryBuiltin("*"),
	"Swift.(file).Int./": (scope, arg) => expr(binaryExpression("|", binaryExpression("/", read(arg(0), scope), read(arg(1), scope)), numericLiteral(0))),
	"Swift.(file).Int.%": binaryBuiltin("%"),
	"Swift.(file).Int.<": binaryBuiltin("<"),
	"Swift.(file).Int.>": binaryBuiltin(">"),
	"Swift.(file).Int.<=": binaryBuiltin("<="),
	"Swift.(file).Int.>=": binaryBuiltin(">="),
	"Swift.(file).Int.&": binaryBuiltin("&"),
	"Swift.(file).Int.|": binaryBuiltin("|"),
	"Swift.(file).Int.^": binaryBuiltin("^"),
	"Swift.(file).Int.==": binaryBuiltin("==="),
	"Swift.(file).Int.!=": binaryBuiltin("!=="),
	"Swift.(file).Int.+=": assignmentBuiltin("+="), // TODO: Fix to mutate
	"Swift.(file).Int.-=": assignmentBuiltin("-="), // TODO: Fix to mutate
	"Swift.(file).Int.*=": assignmentBuiltin("*="), // TODO: Fix to mutate
	"Swift.(file).SignedNumeric.-": wrapped((scope, arg) => expr(unaryExpression("-", read(arg(0), scope)))),
	"Swift.(file).Sequence.reduce": (scope, arg, type) => callable((innerScope, innerArg) => {
		return call(expr(identifier("Sequence$reduce")), undefinedValue, [arg(0)], scope);
	}, returnType(type)),
	"Swift.(file).Strideable....": wrapped((scope, arg) => expr(arrayExpression([read(arg(0), scope), read(arg(1), scope)]))),
	"Swift.(file).Bool.init(_builtinBooleanLiteral:)": wrapped(returnOnlyArgument),
	"Swift.(file).Bool._getBuiltinLogicValue()": (scope, arg, type) => callable(() => arg(0), returnType(type)),
	"Swift.(file).Bool.&&": wrapped((scope, arg) => expr(logicalExpression("&&", read(arg(0), scope), read(call(arg(1), undefinedValue, [], scope), scope)))),
	"Swift.(file).Bool.||": wrapped((scope, arg) => expr(logicalExpression("||", read(arg(0), scope), read(call(arg(1), undefinedValue, [], scope), scope)))),
	"Swift.(file).Optional.none": () => expr(nullLiteral()),
	"Swift.(file).Optional.==": binaryBuiltin("==="), // TODO: Fix to use proper comparator for internal type
	"Swift.(file).Optional.!=": binaryBuiltin("!=="), // TODO: Fix to use proper comparator for internal type
	"Swift.(file).Optional.flatMap": returnTodo,
	"Swift.(file)._OptionalNilComparisonType.init(nilLiteral:)": wrapped(() => expr(nullLiteral())),
	"Swift.(file).Collection.count": returnLength,
	"Swift.(file).Collection.map": (scope, arg) => expr(callExpression(memberExpression(memberExpression(arrayExpression([]), identifier("map")), identifier("bind")), [read(arg(0), scope)])),
	"Swift.(file).BidirectionalCollection.joined(separator:)": (scope, arg) => expr(callExpression(memberExpression(read(arg("this"), scope), identifier("join")), [read(arg(0), scope)])),
	"Swift.(file).String.init": wrapped((scope, arg) => call(expr(identifier("String")), undefinedValue, [arg(0)], scope)),
	"Swift.(file).String.+": binaryBuiltin("+"),
	"Swift.(file).String.lowercased()": (scope, arg, type) => callable(() => call(expr(memberExpression(read(arg(0), scope), identifier("toLowerCase"))), undefinedValue, [], scope), returnType(type)),
	"Swift.(file).String.uppercased()": (scope, arg, type) => callable(() => call(expr(memberExpression(read(arg(0), scope), identifier("toUpperCase"))), undefinedValue, [], scope), returnType(type)),
	"Swift.(file).??": returnTodo,
	"Swift.(file).~=": (scope, arg) => expr(binaryExpression("===", read(arg(0), scope), read(arg(1), scope))),
	"Swift.(file).Array.init": wrapped((scope, arg) => call(expr(memberExpression(identifier("Array"), identifier("from"))), undefinedValue, [arg(0)], scope)),
	"Swift.(file).Array.count": returnLength,
	"Swift.(file).Array.subscript": returnTodo,
	"Swift.(file).Double.init(_builtinIntegerLiteral:)": wrapped(returnOnlyArgument),
	"Swift.(file).Double.+": binaryBuiltin("+"),
	"Swift.(file).Double.-": binaryBuiltin("-"),
	"Swift.(file).Double.*": binaryBuiltin("*"),
	"Swift.(file).Double./": binaryBuiltin("/"),
	"Swift.(file).Double.%": binaryBuiltin("%"),
	"Swift.(file).Double.<": binaryBuiltin("<"),
	"Swift.(file).Double.>": binaryBuiltin(">"),
	"Swift.(file).Double.<=": binaryBuiltin("<="),
	"Swift.(file).Double.>=": binaryBuiltin(">="),
	"Swift.(file).Double.&": binaryBuiltin("&"),
	"Swift.(file).Double.|": binaryBuiltin("|"),
	"Swift.(file).Double.^": binaryBuiltin("^"),
	"Swift.(file).Double.==": binaryBuiltin("==="),
	"Swift.(file).Double.!=": binaryBuiltin("!=="),
	"Swift.(file).Double.+=": assignmentBuiltin("+="),
	"Swift.(file).Double.-=": assignmentBuiltin("-="),
	"Swift.(file).Double.*=": assignmentBuiltin("*="),
	"Swift.(file).Double./=": assignmentBuiltin("/="),
	"Swift.(file).Float.init(_builtinIntegerLiteral:)": wrapped(returnOnlyArgument),
	"Swift.(file).Float.+": binaryBuiltin("+"),
	"Swift.(file).Float.-": binaryBuiltin("-"),
	"Swift.(file).Float.*": binaryBuiltin("*"),
	"Swift.(file).Float./": binaryBuiltin("/"),
	"Swift.(file).Float.%": binaryBuiltin("%"),
	"Swift.(file).Float.<": binaryBuiltin("<"),
	"Swift.(file).Float.>": binaryBuiltin(">"),
	"Swift.(file).Float.<=": binaryBuiltin("<="),
	"Swift.(file).Float.>=": binaryBuiltin(">="),
	"Swift.(file).Float.&": binaryBuiltin("&"),
	"Swift.(file).Float.|": binaryBuiltin("|"),
	"Swift.(file).Float.^": binaryBuiltin("^"),
	"Swift.(file).Float.==": binaryBuiltin("==="),
	"Swift.(file).Float.!=": binaryBuiltin("!=="),
	"Swift.(file).Float.+=": assignmentBuiltin("+="),
	"Swift.(file).Float.-=": assignmentBuiltin("-="),
	"Swift.(file).Float.*=": assignmentBuiltin("*="),
	"Swift.(file).Float./=": assignmentBuiltin("/="),
	"Swift.(file).FloatingPoint.==": binaryBuiltin("==="),
	"Swift.(file).FloatingPoint.!=": binaryBuiltin("!=="),
	"Swift.(file).FloatingPoint.squareRoot()": (scope, arg, type) => callable(() => expr(arrayExpression([callExpression(memberExpression(identifier("Math"), identifier("sqrt")), [read(arg(0), scope)])])), returnType(type)),
	"Swift.(file).print(_:separator:terminator:)": (scope, arg, type) => call(expr(memberExpression(identifier("console"), identifier("log"))), undefinedValue, [arg(0, "items")], scope),
};
