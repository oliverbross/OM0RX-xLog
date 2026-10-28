public struct ADIFRecord: Sendable { public var fields:[String:String]; public init(fields:[String:String]) { self.fields = fields } }
public struct ADIFParser { public init(){}; public func records(in text: String) -> [ADIFRecord] { [] } }
