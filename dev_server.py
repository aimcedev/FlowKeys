import sys
from livereload import Server

if __name__ == '__main__':
    # Get port from command line or default to 8000
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    
    server = Server()
    # Watch modifications for html, css, and js
    server.watch('*.html')
    server.watch('css/')
    server.watch('js/')
    
    print(f"\n🚀 Starting Live Reload Server on port {port}...")
    print("If your browser doesn't open automatically, just go to:")
    print(f"👉 http://localhost:{port} \n")
    
    # Start the server and automatically launch browser
    server.serve(root='.', port=port, open_url_delay=1)
