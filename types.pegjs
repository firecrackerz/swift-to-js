Top
  = _ type:Type _ { return type; }

Type
  = Function / NamespacedType / MetaType / Optional / Generic / Dictionary / Array / Tuple / Modified / Name

Optional
  = type:(Function / NamespacedType / Generic / Dictionary / Array / Tuple / Modified / Name) depth:[?!]+ { return { kind: "optional", type: type, depth: depth.length }; }

Generic
  = base:Name '<' typeArgs:Type* '>' { return { kind: "generic", base: base, arguments: typeArgs }; }

Function
  = attributes:FunctionAttribute* argTypes:Tuple _ throws:('throws' / "rethrows")? _ '->' _ returnType:Type { return { kind: "function", arguments: argTypes, return: returnType, throws: throws === "throws", rethrows: throws === "rethrows", attributes: attributes }; }
FunctionAttribute
  = content:('@autoclosure' / ('@convention(' ('swift' / 'block' / 'c') ')') / '@escaping') _ { return content; }

Tuple
  = '(' types:(TupleContents / _) ')' { return { kind: "tuple", types: types }; }
TupleContents
  = _ (Name ':' _)? head:Type tail:TupleTerm* _ { return typeof tail !== "undefined" ? [head].concat(tail) : [head]; }
TupleTerm
  = _ ',' _ (Name ':' _)? type:Type { return type; }

Array
  = '[' _ type:Type _ ']' { return { kind: "array", type: type }; }

Dictionary
  = '[' _ keyType:Type _ ':' _ valueType:Type _ ']' { return { kind: "dictionary", keyType: keyType, valueType: valueType }; }

MetaType
  = base:(Generic / Optional / Name) '.' as:("Type" / "Protocol") { return { kind: "metatype", base: base, as: as }; }

NamespacedType
  = namespace:Name '.' type:Type { return { kind: "namespaced", namespace: namespace, type: type }; }

Modified
  = modifier:("inout" / "@lvalue") " " _ type:Type { return { kind: "modified", modifier: modifier, type: type }; }

Name
  = head:[a-zA-Z_] tail:[a-zA-Z0-9_\-]* { return { kind: "name", name: head + tail.join("") }; }

_ "whitespace"
  = [ \t\n\r]* { return []; }
