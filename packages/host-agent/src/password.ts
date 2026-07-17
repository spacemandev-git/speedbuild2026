import { randomBytes } from "node:crypto";

export const PASSWORD_WORDS = [
  "acorn", "alder", "amber", "anchor", "apple", "april", "arch", "arrow", "ash", "atlas",
  "badger", "bamboo", "bay", "beacon", "beech", "berry", "birch", "bison", "blade", "bloom",
  "blue", "brook", "brush", "cabin", "cactus", "canyon", "cedar", "charm", "cherry", "cliff",
  "cloud", "clover", "coast", "comet", "coral", "crane", "creek", "crest", "crow", "crystal",
  "daisy", "dawn", "delta", "dove", "drift", "dune", "eagle", "earth", "echo", "elm",
  "ember", "falcon", "fern", "field", "finch", "fjord", "flame", "flora", "forest", "fox",
  "frost", "garden", "garnet", "ginkgo", "glade", "glass", "glen", "globe", "gold", "granite",
  "grape", "grove", "harbor", "hawk", "hazel", "heath", "heron", "hill", "honey", "iris",
  "island", "ivory", "jade", "jasper", "juniper", "lake", "lark", "laurel", "leaf", "lemon",
  "light", "lilac", "lily", "lotus", "luna", "mango", "maple", "marble", "marsh", "meadow",
  "mint", "mist", "moon", "moss", "mount", "nectar", "north", "nova", "oak", "oasis",
  "ocean", "olive", "onyx", "opal", "orchid", "otter", "owl", "palm", "peach", "pearl",
  "pine", "plum", "pond", "prairie", "quartz", "rain", "raven", "reed", "reef", "ridge",
  "river", "robin", "rock", "rose", "ruby", "sage", "sand", "satin", "seal", "shadow",
  "shell", "shore", "silver", "sky", "slate", "snow", "solar", "sparrow", "spice", "spring",
  "spruce", "star", "stone", "storm", "sun", "swan", "tangle", "teal", "thistle", "thorn",
  "tide", "tiger", "topaz", "trail", "tree", "tulip", "valley", "violet", "wave", "west",
  "willow", "wind", "winter", "wren", "yarrow", "zephyr", "agate", "aurora", "basil", "bluff",
  "breeze", "bronze", "canopy", "cinder", "citrus", "cobalt", "copper", "cosmos", "cypress", "fable",
  "feather", "flint", "ginger", "harvest", "indigo", "lagoon", "linen", "magnolia", "meteor", "mulberry",
  "myrtle", "orchard", "pebble", "pepper", "petal", "poppy", "rainbow", "redwood", "sequoia", "summit",
] as const;

function randomIndex(limit: number): number {
  const ceiling = Math.floor(256 / limit) * limit;
  while (true) {
    const value = randomBytes(1)[0];
    if (value !== undefined && value < ceiling) return value % limit;
  }
}

export function generatePassword(wordCount = 4): string {
  if (!Number.isInteger(wordCount) || wordCount < 1) throw new Error("word count must be a positive integer");
  return Array.from({ length: wordCount }, () => PASSWORD_WORDS[randomIndex(PASSWORD_WORDS.length)]).join("-");
}
