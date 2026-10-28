from pathlib import Path
import hashlib,json
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-review-verification-20261028-12824393/root')
p=root/'Sources/XLogApp/AppModel.swift'
s=p.read_text()
def method(name):
    start=s.index('    func '+name+'(')
    pos=s.index('{',start); depth=1; end=pos+1
    while depth:
        depth+=(s[end]=='{')-(s[end]=='}');end+=1
    return s[start:end]
methods='\n'.join(method(name) for name in ['importADIF','exportADIF'])
scaffold='''import Foundation
import XLogCore
enum Modal { case OK }
class NSOpenPanel { static var selected:URL?; var allowedContentTypes:[Kind]=[];var allowsMultipleSelection=false;var url:URL?{Self.selected};func runModal()->Modal{.OK};enum Kind{case data} }
class NSSavePanel { static var selected:URL?;var nameFieldStringValue="";var url:URL?{Self.selected};func runModal()->Modal{.OK} }
struct AppBanner { enum Kind{case success,error};let message:String;let kind:Kind }
class Model {
 var database:LogbookDatabase?;var qsos:[QSO]=[];var banner:AppBanner?
 init(_ database:LogbookDatabase?){self.database=database}
 func reload(){qsos=(try? database?.fetch(limit:2000,search:"")) ?? []}
'''+methods+'\n}\n'
body='''let root=FileManager.default.temporaryDirectory.appendingPathComponent("xlog-second-pass-legacy-\\(UUID().uuidString)")
try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
let db=try LogbookDatabase(url:root.appendingPathComponent("log.sqlite"))
let good=ADIFRecord(fields:["CALL":"K1ABC","QSO_DATE":"20261028","TIME_ON":"120000","BAND":"20m","MODE":"CW"])
var bad=good;bad.fields["CALL"]="K2BAD";bad.fields["TIME_ON"]="12345"
let input=root.appendingPathComponent("mixed.adi");try (good.adifDocument+bad.recordDocument).write(to:input,atomically:true,encoding:.utf8)
NSOpenPanel.selected=input
let model=Model(db);model.importADIF()
let firstCount=try db.count(),firstBanner=model.banner!.message
model.importADIF();let repeatCount=try db.count()
let missing=Model(nil);missing.importADIF()
// Populate the actual database beyond the retained UI query cap.
for index in 0..<2001 {try db.save(QSO(call:"N\\(index)ABC",start:Date(timeIntervalSince1970:1790000000+Double(index)),band:"20m",mode:"CW"))}
model.reload();let visible=model.qsos.count
let export=root.appendingPathComponent("export.adi");NSSavePanel.selected=export;model.exportADIF()
let exported=ADIFParser().records(in:try String(contentsOf:export,encoding:.utf8)).count
let total=try db.count()
precondition(firstCount==1 && repeatCount==2 && firstBanner=="Imported 2 ADIF records")
precondition(missing.banner!.message=="Imported 2 ADIF records")
precondition(visible==2000 && exported==2000 && total==2003)
let result:[String:Any] = ["fixtureRoot":root.path,"sourceBoundary":"Exact importADIF/exportADIF method bodies; chooser and surrounding model scaffolding stubbed", "firstCount":firstCount,"firstBanner":firstBanner,"repeatCount":repeatCount,"nilDatabaseBanner":missing.banner!.message,"totalDatabaseCount":total,"visibleCount":visible,"exportedCount":exported,"exportBanner":model.banner!.message]
print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
db.close()
'''
(out/'verify_legacy_methods.swift').write_text(scaffold+body)
(out/'legacy-method-source.json').write_text(json.dumps({'source':str(p),'sourceSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'methods':['importADIF','exportADIF'],'extractedSHA256':hashlib.sha256(methods.encode()).hexdigest(),'stubs':['NSOpenPanel','NSSavePanel','AppBanner','surrounding model including fetch-limit-equivalent reload']},indent=2)+'\n')
