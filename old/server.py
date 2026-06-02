from http.server import HTTPServer,BaseHTTPRequestHandler
import json,os,urllib.parse,signal,sys
signal.signal(signal.SIGINT,lambda sig,frame:sys.exit(0))
AUDIO_EXTS={'.mp3','.aac','.flac','.wav','.ogg','.m4a','.wma'}
BASE_DIR=os.path.dirname(os.path.abspath(__file__))
class MyHandler(BaseHTTPRequestHandler):
 def end_headers(self):self.send_header('Access-Control-Allow-Origin','*');super().end_headers()
 def do_OPTIONS(self):self.send_response(200);self.end_headers()
 def do_GET(self):
  if self.path=='/api/songs':
   d={}
   for r,_,fs in os.walk(BASE_DIR):
    rd=os.path.relpath(r,BASE_DIR).replace('\\','/')
    af=[]
    for f in fs:
     e=os.path.splitext(f)[1].lower()
     if e in AUDIO_EXTS:af.append(f)
    if af:d[rd]=af
   self.send_response(200)
   self.send_header('Content-Type','application/json')
   self.end_headers()
   self.wfile.write(json.dumps(d,ensure_ascii=False).encode())
   return
  p=os.path.join(BASE_DIR,urllib.parse.unquote(self.path[1:]))
  if os.path.isfile(p):
   try:
    s=os.path.getsize(p)
    st,en=0,s-1
    rh=self.headers.get('Range')
    if rh:
     st,en=rh.replace('bytes=','').split('-')
     st=int(st)
     en=int(en)if en else s-1
    self.send_response(206 if rh else 200)
    self.send_header('Content-Type',self.guess_type(p))
    self.send_header('Content-Length',en-st+1)
    self.send_header('Accept-Ranges','bytes')
    self.send_header('Content-Range',f'bytes {st}-{en}/{s}')
    self.end_headers()
    with open(p,'rb')as f:f.seek(st);self.wfile.write(f.read(en-st+1))
   except:pass
   return
  self.send_error(404)
 def guess_type(self,p):
  t={'.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.m4a':'audio/m4a','.aac':'audio/aac','.html':'text/html','.js':'application/javascript','.css':'text/css'}
  return t.get(os.path.splitext(p)[1].lower(),'application/octet-stream')
if __name__=='__main__':HTTPServer(('0.0.0.0',18250),MyHandler).serve_forever()