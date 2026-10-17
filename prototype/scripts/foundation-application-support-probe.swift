import Foundation

guard let url = try? FileManager.default.url(
    for: .applicationSupportDirectory,
    in: .userDomainMask,
    appropriateFor: nil,
    create: false
) else {
    FileHandle.standardError.write(Data("Application Support is unavailable.\n".utf8))
    exit(2)
}
print(url.standardizedFileURL.path)
