import Foundation

/// A definition admitted for shared runtime creation. The canonical bytes and digest
/// are computed once and travel together so callers cannot accidentally create a
/// session from a different serialization than the catalog entry they presented.
public struct ContestDeclarativeCatalogEntry: Sendable {
    public let definition: ContestDeclarativeDefinition
    public let canonicalDefinitionData: Data

    public init(definition: ContestDeclarativeDefinition) throws {
        let canonical = try definition.canonicalStorageData()
        guard !canonical.isEmpty,
              definition.identity.sourceRevision == definition.definitionDigest else {
            throw ContestDefinitionError.digestMismatch
        }
        self.definition = definition
        canonicalDefinitionData = canonical
    }

    public var identity: ContestRuleIdentity { definition.identity }
    public var definitionDigest: String { definition.definitionDigest }
    public var rule: DeclarativeContestRule { DeclarativeContestRule(definition: definition) }
}

/// The reviewed built-in archive definitions exposed by the common contest runtime.
/// New authored definitions use the same `ContestDeclarativeCatalogEntry` admission
/// contract and do not require another contest rule implementation.
public enum ContestBuiltInDeclarativeCatalog {
    public static func operatorArchiveEntries() throws -> [ContestDeclarativeCatalogEntry] {
        let entries = try ContestPackagedDefinitionLoader.bundledEntries()
        guard entries.count == 7, Set(entries.map(\.identity)).count == entries.count else {
            throw ContestDefinitionError.invalidDefinition([
                "catalog: expected seven unique packaged declarative definitions",
            ])
        }
        return entries
    }
}
