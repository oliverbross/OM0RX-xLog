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
        let definitions = try TenTenSeasonalVariant.allCases.map {
            try TenTenDeclarativeDefinitions.archiveDefinition(for: $0)
        } + CWUniqueCallContestVariant.allCases.map {
            try CWUniqueCallDeclarativeDefinitions.archiveDefinition(for: $0)
        }
        let entries = try definitions.map(ContestDeclarativeCatalogEntry.init)
        guard Set(entries.map(\.identity)).count == entries.count else {
            throw ContestDefinitionError.invalidDefinition([
                "catalog: declarative catalog identities must be unique",
            ])
        }
        return entries.sorted {
            ($0.identity.id, $0.identity.version, $0.identity.edition, $0.identity.sourceRevision) <
            ($1.identity.id, $1.identity.version, $1.identity.edition, $1.identity.sourceRevision)
        }
    }
}
