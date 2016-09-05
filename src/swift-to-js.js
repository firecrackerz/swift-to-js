var readline = require("readline");
var fs = require("fs");

// Basic Standard Library
var stdlib = require("./stdlib.js");
var types = stdlib.types;
var enums = stdlib.enums;
var builtins = stdlib.builtins;
var usedBuiltins = {};

var Parser = require("./parser.js");
var parser = new Parser();

var CodeGen = require("./codegen.js");

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false
});

rl.on("line", function(line){
	parser.addLine(line);
});

rl.on("close", function() {
	var codegen = new CodeGen();
	codegen.consume(parser.declarations);
	var out = fs.openSync(process.argv[2], "w");
	codegen.buffer.lines.forEach(line => fs.write(out, line + "\n"));
});
