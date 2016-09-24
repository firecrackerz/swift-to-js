var Parser = require("./parser.js");

function findBasicBlock(blocks, descriptor) {
	if (descriptor.reference) {
		for (var i = 0; i < blocks.length; i++) {
			if (blocks[i].name == descriptor.reference) {
				return blocks[i];
			}
		}
		throw new Error("Unable to find basic block: " + descriptor.reference);
	}
	if (descriptor.inline) {
		return descriptor.inline;
	}
	throw new Error("Neither a reference nor an inline block!");
}

function unwrapSimpleStructInstructions(instructions, types) {
	instructions.forEach(instruction => {
		instruction.inputs.forEach(input => {
			switch (input.interpretation) {
				case "struct":
					var structType = types[input.type];
					if (structType && structType.fields.length == 1) {
						input.interpretation = "contents";
					}
					break;
				case "struct_extract":
					var structType = types[input.type];
					if (structType && structType.fields.length == 1) {
						input.interpretation = "contents";
						delete input.fieldName;
					}
					break;
				case "struct_element_addr":
					var structType = types[input.type];
					if (structType && structType.fields.length == 1) {
						input.interpretation = "contents";
						delete input.fieldName;
					}
					break;
			}
		});
	})
}

function unwrapStrings(instructions) {
	instructions.forEach(instruction => {
		instruction.inputs.forEach(input => {
			switch (input.interpretation) {
				case "struct":
					if (input.type == "_StringCore" || input.type == "StaticString") {
						input.interpretation = "contents";
						input.localNames.splice(1, input.localNames.length - 2);
					}
					break;
				case "struct_extract":
					if (input.type == "_StringCore") {
						if (input.fieldName == "_countAndFlags") {
							input.fieldName = "length";
						} else if (input.fieldName == "_baseAddress") {
							input.interpretation = "contents";
							delete input.fieldName;
						}
					} else if (input.type == "StaticString") {
						if (input.fieldName == "_utf8CodeUnitCount") {
							input.fieldName = "length";
						} else if (input.fieldName == "_startPtrOrData") {
							input.interpretation = "contents";
							delete input.fieldName;
						}
					}
					break;
				case "struct_element_addr":
					if (input.type == "_StringCore" || input.type == "StaticString") {
						throw new Error("Cannot take the address of a " + input.type + " field!");
					}
					break;
				case "global_addr":
					if (input.globalName == "_Tvs19_emptyStringStorageVs6UInt32") {
						input.interpretation = "string_literal";
						input.value = "";
						delete input.globalName;
					}
			}
		});
	});
}

const isOptionalType = typeName => typeName == "Optional" || typeName == "ImplicitlyUnwrappedOptional";

function unwrapOptionalEnums(instructions) {
	instructions.forEach(instruction => {
		instruction.inputs.forEach(input => {
			switch (input.interpretation) {
				case "enum":
					if (isOptionalType(input.type)) {
						if (input.caseName.toLowerCase() == "some") {
							input.interpretation = "contents";
						} else {
							input.interpretation = "undefined_literal";
						}
						delete input.type;
						delete input.caseName;
					}
					break;
				case "unchecked_enum_data":
					if (isOptionalType(input.type)) {
						input.interpretation = "contents";
						delete input.type;
					}
					break;
				case "select_enum":
				case "select_enum_addr":
					if (isOptionalType(input.type)) {
						var defaultLocal;
						var trueLocal;
						var falseLocal;
						input.cases.forEach((enumCase, index) => {
							var caseName = Parser.caseNameForEnum(enumCase.case);
							if (caseName) {
								if (caseName.toLowerCase() == "some") {
									trueLocal = index + 1;
								} else {
									falseLocal = index + 1;
								}
							} else {
								defaultLocal = index + 1;
							}
						});
						delete input.cases;
						delete input.type;
						input.interpretation = input.interpretation == "select_enum" ? "select_defined" : "select_defined_addr";
						if ((trueLocal | defaultLocal) > (falseLocal | defaultLocal)) {
							// Shuffle the input local names such that the "some" local is first
							input.localNames = [input.localNames[0], input.localNames[2], input.localNames[1]];
						}
					}
					break;
				case "init_enum_data_addr":
					if (isOptionalType(input.type)) {
						throw new Error("Cannot use init_enum_data_addr on an " + input.type + "!");
					}
					break;
				case "unchecked_take_enum_data_addr":
					if (isOptionalType(input.type)) {
						input.interpretation = "contents";
						//throw new Error("Cannot use unchecked_take_enum_data_addr on an " + input.type + "!");
					}
					break;
			}
		});
		switch (instruction.operation) {
			case "switch_enum":
				if (isOptionalType(instruction.type)) {
					instruction.operation = "conditional_defined_branch";
					var defaultBlock;
					var trueBlock;
					var falseBlock;
					instruction.cases.forEach(enumCase => {
						var caseName = Parser.caseNameForEnum(enumCase.case);
						if (caseName) {
							if (caseName.toLowerCase() == "some") {
								trueBlock = enumCase.basicBlock;
							} else {
								falseBlock = enumCase.basicBlock;
							}
						} else {
							defaultBlock = enumCase.basicBlock;
						}
					});
					instruction.trueBlock = trueBlock || defaultBlock;
					instruction.falseBlock = falseBlock || defaultBlock;
					delete instruction.cases;
				}
				break;
			case "inject_enum_addr":
				if (isOptionalType(instruction.type)) {
					instruction.operation = "store";
					if (instruction.caseName.toLowerCase() == "some") {
						// Normally would delete, but since can be immediately followed by select_enum_addr, we need to put _some_ value in
						instruction.inputs.unshift({
							localNames: [],
							interpretation: "integer_literal",
							value: 0,
						});
					} else {
						instruction.inputs.unshift({
							localNames: [],
							interpretation: "undefined_literal",
						});
					}
				}
				break;
		}
	});
}

var countOfUsesOfLocal = (instruction, localName) => instruction.inputs.reduce((count, input) => count + input.localNames.filter(usedName => usedName == localName).length, 0);

var fuseableWithAssignment = instruction => {
	switch (instruction.operation) {
		case "assignment":
			return true;
		case "return":
			return true;
		case "throw":
			return true;
		case "store":
			return true;
		case "branch":
			return true;
		default:
			return false;
	}
};

var interpretationsWithoutSideEffects = ["contents", "integer_literal", "float_literal", "string_literal", "undefined_literal", "enum", "struct", "tuple", "alloc_stack", "alloc_box", "project_box", "struct_element_addr", "ref_element_addr", "global_addr", "select_enum", "select_value", "index_raw_pointer", "index_addr", "metatype", "class_method", "open_existential_ref"];
var instructionHasSideEffects = instruction => instruction.operation != "assignment" || interpretationsWithoutSideEffects.indexOf(instruction.operation) == -1;

function fuseAssignments(instructions, downstreamInstructions) {
	fuse_search:
	for (var i = 0; i < instructions.length - 1; ) {
		var instruction = instructions[i];
		if (instruction.operation == "assignment" && instruction.inputs.length == 1) {
			var replacementInput = instruction.inputs[0];
			proposed_search:
			for (var k = i + 1; k < instructions.length; k++) {
				var proposedInstruction = instructions[k];
				if (fuseableWithAssignment(proposedInstruction) && countOfUsesOfLocal(proposedInstruction, instruction.destinationLocalName) == 1) {
					for (var l = k + 1; l < instructions.length; l++) {
						if (countOfUsesOfLocal(instructions[l], instruction.destinationLocalName) != 0) {
							break proposed_search;
						}
					}
					if (downstreamInstructions.some(otherInstruction => countOfUsesOfLocal(otherInstruction, instruction.destinationLocalName) != 0)) {
						break proposed_search;
					}
					var success = false;
					proposedInstruction.inputs = proposedInstruction.inputs.map(input => {
						if (input.localNames[0] != instruction.destinationLocalName) {
							return input;
						}
						switch (input.interpretation) {
							case "apply":
								switch (replacementInput.interpretation) {
									case "contents":
										success = true;
										return replacementInput;
									case "class_method":
										input.localNames[0] = replacementInput.localNames[0];
										input.fieldName = replacementInput.entry;
										success = true;
										return input;
								}
								break;
							case "load":
								switch (replacementInput.interpretation) {
									case "contents":
										success = true;
										return replacementInput;
									case "ref_element_addr":
										replacementInput.interpretation = "struct_extract";
										success = true;
										return replacementInput;
								}
								break;
							case "contents":
								success = true;
								return replacementInput;
						}
						return input;
					})
					if (success) {
						instructions.splice(i, 1);
						continue fuse_search;
					}
				}
				if (instructionHasSideEffects(proposedInstruction)) {
					break;
				}
			}
		}
		i++;
	}
}

function fuseGlobalAllocations(instructions, downstreamInstructions) {
	var allocIndex = -1;
	while ((allocIndex = instructions.findIndex((instruction, i) => (i > allocIndex) && instruction.operation == "alloc_global")) != -1) {
		var allocInstruction = instructions[allocIndex];
		var assignmentInstruction = instructions.find((instruction, i) => {
			if (i > allocIndex && instruction.operation == "assignment") {
				var input = instruction.inputs[0];
				return input.interpretation == "global_addr" && input.globalName == allocInstruction.name;
			}
		});
		if (assignmentInstruction) {
			var destinationLocalName = assignmentInstruction.destinationLocalName;
			var storeInstruction = instructions.find((instruction, i) => {
				if (i > allocIndex && instruction.operation == "store") {
					var input = instruction.inputs[1];
					return input.localNames[0] == destinationLocalName && input.interpretation == "contents";
				}
			});
			if (storeInstruction) {
				storeInstruction.initializes = true;
			}
			instructions.splice(allocIndex, 1);
		}
	}
}

function deadAssignmentElimination(instructions, downstreamInstructions) {
	for (var i = 0; i < instructions.length; ) {
		var instruction = instructions[i];
		if (instruction.operation == "assignment" && !instructionHasSideEffects(instruction)) {
			if (!instructions.slice(i+1).concat(downstreamInstructions).some(otherInstruction => countOfUsesOfLocal(otherInstruction, instruction.destinationLocalName) != 0)) {
				instructions.splice(i, 1);
				continue;
			}
		}
		i++;
	}
}
var blockReferencesForInstructionTypes = {
	"branch": ins => [ins.block],
	"conditional_branch": ins => [ins.trueBlock, ins.falseBlock],
	"conditional_defined_branch": ins => [ins.trueBlock, ins.falseBlock],
	"try_apply": ins => [ins.normalBlock, ins.errorBlock],
	"switch_enum": ins => ins.cases.map(c => c.basicBlock),
	"switch_enum_addr": ins => ins.cases.map(c => c.basicBlock),
	"checked_cast_branch": ins => [ins.trueBlock, ins.falseBlock],
	"checked_cast_addr_br": ins => [ins.trueBlock, ins.falseBlock],
};

function newLocalName(declaration, basicBlock) {
	var i = 0;
	while (declaration.localNames.indexOf(i) != -1) {
		i++;
	}
	declaration.localNames.push(i);
	basicBlock.localNames.push(i);
	return i;
}

function serializedClone(object) {
	return JSON.parse(JSON.stringify(object));
}

function blockReferencesForInstructions(instructions) {
	var instruction = instructions[instructions.length - 1];
	var blockReferences = blockReferencesForInstructionTypes[instruction.operation];
	return blockReferences ? blockReferences(instruction) : [];
}

function deepBlockReferencesForInstructions(instructions)
{
	var result = [];
	blockReferencesForInstructions(instructions).forEach(descriptor => {
		if (descriptor.inline) {
			result = result.concat(result, deepBlockReferencesForInstructions(descriptor.inline.instructions));
		} else if (descriptor.reference) {
			result.push({
				instructionList: instructions,
				toBlockName: descriptor.reference,
				descriptor: descriptor,
			});
		}
	})
	return result;
}

function recursiveReferencesFromBlock(basicBlock, basicBlocks)
{
	var result = deepBlockReferencesForInstructions(basicBlock.instructions);
	for (var i = 0; i < result.length; i++) {
		deepBlockReferencesForInstructions(findBasicBlock(basicBlocks, result[i].descriptor).instructions).forEach(newRef => {
			if (!result.some(existingRef => existingRef.toBlockName == newRef.toBlockName)) {
				result.push(newRef);
			}
		});
	}
	return result;
}

function blocksThatReferenceBlock(basicBlock, basicBlocks)
{
	return basicBlocks.filter(otherBlock => recursiveReferencesFromBlock(otherBlock, basicBlocks).some(ref => ref.toBlockName == basicBlock.name));
}

function inlineBlocks(basicBlocks) {
	var work = basicBlocks.map((block, index) => {
		return {
			instructions: block.instructions,
			blockIndex: index,
		}
	});
	for (var i = 0; i < work.length; i++) {
		deepBlockReferencesForInstructions(work[i].instructions).forEach(reference => {
			var sourceBlockName = reference.toBlockName;
			var sourceBlock = findBasicBlock(basicBlocks, { reference: sourceBlockName });
			var sourceBlockIndex = basicBlocks.indexOf(sourceBlock);
			if (deepBlockReferencesForInstructions(sourceBlock.instructions, basicBlocks).length != 0) {
				if (sourceBlockIndex <= work[i].blockIndex) {
					return;
				}
				var hasBackwardsReference = blocksThatReferenceBlock(sourceBlock, basicBlocks).some(otherBlock => basicBlocks.indexOf(otherBlock) > sourceBlockIndex);
				if (hasBackwardsReference) {
					return;
				}
			}
			sourceBlock = serializedClone(sourceBlock);
			var instruction = reference.instructionList[reference.instructionList.length-1];
			var instructions;
			if (instruction.operation == "branch") {
				instructions = reference.instructionList;
				instructions.splice(instructions.length - 1, 1)
				instruction.inputs.forEach((input, index) => {
					instructions.push({
						operation: "assignment",
						destinationLocalName: sourceBlock.arguments[index].localName,
						inputs: [ input ],
					})
				});
				sourceBlock.instructions.forEach(instruction => instructions.push(instruction));
			} else {
				reference.descriptor.inline = sourceBlock;
				delete reference.descriptor.reference;
				instructions = reference.instructionList;
			}
			work.push({
				instructions: instructions,
				blockIndex: work[i].blockIndex,
			});
		});
	}
}

function pruneDeadBlocks(basicBlocks) {
	// Always leave the first block alone, it's the entry point
	for (var i = 1; i < basicBlocks.length; i++) {
		while (i < basicBlocks.length && blocksThatReferenceBlock(basicBlocks[i], basicBlocks).length == 0) {
			basicBlocks.splice(i, 1);
		}
	}
	basicBlocks.forEach((block, i) => {
		block.hasBackReferences = blocksThatReferenceBlock(block, basicBlocks).some(otherBlock => basicBlocks.indexOf(otherBlock) >= i);
	});
}

function allInstructionLists(basicBlocks) {
	var result = [];
	basicBlocks = basicBlocks.slice();
	for (var i = 0; i < basicBlocks.length; i++) {
		blockReferencesForInstructions(basicBlocks[i].instructions).forEach(descriptor => {
			if (descriptor.inline) {
				basicBlocks.push(descriptor.inline);
			}
		});
	}
	return basicBlocks.map((block, i) => {
		var blockReferences = [{ inline: block }];
		var downstreamInstructions = [];
		for (var j = 0; j < blockReferences.length; j++) {
			var discoveredBlock = findBasicBlock(basicBlocks, blockReferences[j]);
			if (block !== discoveredBlock) {
				downstreamInstructions = downstreamInstructions.concat(discoveredBlock.instructions);
			}
			blockReferencesForInstructions(discoveredBlock.instructions).forEach(descriptor => {
				if (blockReferences.indexOf(descriptor) == -1) {
					blockReferences.push(descriptor)
				}
			});
		}
		return {
			instructions: basicBlocks[i].instructions,
			downstreamInstructions: downstreamInstructions
		};
	});
}

function optimize(declaration, types) {
	if (declaration.type == "function") {
		inlineBlocks(declaration.basicBlocks);
		allInstructionLists(declaration.basicBlocks).forEach(item => {
			var instructions = item.instructions;
			var downstreamInstructions = item.downstreamInstructions;
			unwrapSimpleStructInstructions(instructions, types);
			unwrapOptionalEnums(instructions);
			unwrapStrings(instructions);
			fuseGlobalAllocations(instructions);
			fuseAssignments(instructions, downstreamInstructions);
		});
		inlineBlocks(declaration.basicBlocks);
		allInstructionLists(declaration.basicBlocks).forEach(item => {
			var instructions = item.instructions;
			var downstreamInstructions = item.downstreamInstructions;
			fuseAssignments(instructions, downstreamInstructions);
			deadAssignmentElimination(instructions, downstreamInstructions);
		});
		pruneDeadBlocks(declaration.basicBlocks);
	}
	if (declaration.type == "vtable") {
		for (var key in declaration.entries) {
			if (/\!deallocator$/.test(key)) {
				delete declaration.entries[key];
			}
		}
	}
}

function optimizeTypes(types) {
	for (var key in types) {
		if (types.hasOwnProperty(key)) {
			var type = types[key];
			switch (type.personality) {
				case "struct":
					if (type.fields.length == 1) {
						type.fields = [];
						type.personality = "class";
					}
					break;
				case "enum":
					if (type.name == "Optional" || type.name == "ImplicitlyUnwrappedOptional") {
						delete types[key];
					}
					break;
			}
		}
	}
}

module.exports = {
	"optimize": optimize,
	"optimizeTypes": optimizeTypes,
}