#!/usr/bin/env python3
"""
Live Transcriber - Server Starter
==================================
Startet den Proxy-Server und den Vite/React Dev-Server parallel.
"""

import subprocess
import sys
import os
import signal
import time
import threading
from datetime import datetime

# Farbcodes für Windows Terminal
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

# Status der Server
server_status = {
    'proxy': {'running': False, 'process': None},
    'vite': {'running': False, 'process': None}
}

def print_banner():
    """Zeigt das Start-Banner an."""
    os.system('cls' if os.name == 'nt' else 'clear')
    print(f"""
{Colors.CYAN}{Colors.BOLD}╔══════════════════════════════════════════════════════════════╗
║                 🎙️  LIVE TRANSCRIBER                          ║
║                    Server Manager                             ║
╚══════════════════════════════════════════════════════════════╝{Colors.END}
""")

def print_status():
    """Zeigt den aktuellen Status beider Server an."""
    proxy_icon = f"{Colors.GREEN}●{Colors.END}" if server_status['proxy']['running'] else f"{Colors.RED}○{Colors.END}"
    vite_icon = f"{Colors.GREEN}●{Colors.END}" if server_status['vite']['running'] else f"{Colors.RED}○{Colors.END}"
    
    print(f"""
{Colors.BOLD}┌─────────────────────────────────────────────────────────────┐
│  SERVER STATUS                                               │
├─────────────────────────────────────────────────────────────┤{Colors.END}
│  {proxy_icon}  Proxy Server     →  http://localhost:3001            │
│  {vite_icon}  Vite/React       →  http://localhost:5173            │
{Colors.BOLD}└─────────────────────────────────────────────────────────────┘{Colors.END}
""")

def print_commands():
    """Zeigt die verfügbaren Befehle an."""
    print(f"""
{Colors.YELLOW}{Colors.BOLD}┌─────────────────────────────────────────────────────────────┐
│  BEFEHLE                                                    │
├─────────────────────────────────────────────────────────────┤
│  [q] oder [Ctrl+C]  →  Beide Server stoppen & beenden       │
│  [r]                →  Beide Server neu starten             │
│  [s]                →  Status anzeigen                      │
│  [o]                →  App im Browser öffnen                │
└─────────────────────────────────────────────────────────────┘{Colors.END}
""")

def drain_output(process, name):
    """Leert den Output-Buffer eines Prozesses im Hintergrund."""
    def reader():
        try:
            while True:
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break
                # Optional: Ausgabe anzeigen (auskommentiert für weniger Spam)
                # if line:
                #     print(f"  [{name}] {line.decode('utf-8', errors='ignore').strip()}")
        except:
            pass
    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    return thread

def start_proxy_server():
    """Startet den Proxy-Server in einem komplett separaten Prozess."""
    try:
        # Eigene Umgebung für den Prozess
        env = os.environ.copy()
        
        # Windows: START /B für komplett unabhängigen Prozess
        if os.name == 'nt':
            process = subprocess.Popen(
                ['node', 'proxy-server.js'],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
            )
        else:
            process = subprocess.Popen(
                ['node', 'proxy-server.js'],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True
            )
        
        server_status['proxy']['process'] = process
        server_status['proxy']['running'] = True
        
        # Buffer im Hintergrund leeren, damit Prozess nicht blockiert
        drain_output(process, 'PROXY')
        
        print(f"  {Colors.GREEN}✓{Colors.END} Proxy Server gestartet (PID: {process.pid})")
        return process
    except Exception as e:
        print(f"  {Colors.RED}✗{Colors.END} Proxy Server Fehler: {e}")
        server_status['proxy']['running'] = False
        return None

def start_vite_server():
    """Startet den Vite/React Dev-Server in einem komplett separaten Prozess."""
    try:
        # Eigene Umgebung für den Prozess
        env = os.environ.copy()
        
        # Windows: cmd /c für Shell-Kommandos
        if os.name == 'nt':
            process = subprocess.Popen(
                ['cmd', '/c', 'npm', 'run', 'dev'],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
            )
        else:
            process = subprocess.Popen(
                ['npm', 'run', 'dev'],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True
            )
        
        server_status['vite']['process'] = process
        server_status['vite']['running'] = True
        
        # Buffer im Hintergrund leeren, damit Prozess nicht blockiert
        drain_output(process, 'VITE')
        
        print(f"  {Colors.GREEN}✓{Colors.END} Vite/React Server gestartet (PID: {process.pid})")
        return process
    except Exception as e:
        print(f"  {Colors.RED}✗{Colors.END} Vite Server Fehler: {e}")
        server_status['vite']['running'] = False
        return None

def stop_servers():
    """Stoppt beide Server und alle Kindprozesse."""
    print(f"\n  {Colors.YELLOW}Stoppe Server...{Colors.END}")
    
    for name, server in server_status.items():
        if server['process']:
            try:
                pid = server['process'].pid
                if os.name == 'nt':
                    # Windows: Benutze taskkill für den gesamten Prozessbaum
                    # /F = Force, /T = Tree (alle Kindprozesse)
                    result = subprocess.run(
                        ['taskkill', '/F', '/T', '/PID', str(pid)], 
                        capture_output=True,
                        timeout=10
                    )
                    # Auch nach node/npm Prozessen suchen, falls taskkill nicht alles erwischt
                    if name == 'proxy':
                        subprocess.run(['taskkill', '/F', '/IM', 'node.exe', '/FI', f'WINDOWTITLE eq proxy*'], 
                                       capture_output=True, timeout=5)
                else:
                    # Unix: Prozessgruppe beenden
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGTERM)
                        time.sleep(0.5)
                        os.killpg(os.getpgid(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                
                server['running'] = False
                print(f"  {Colors.GREEN}✓{Colors.END} {name.capitalize()} Server gestoppt")
            except subprocess.TimeoutExpired:
                print(f"  {Colors.YELLOW}!{Colors.END} {name.capitalize()}: Timeout beim Beenden")
            except Exception as e:
                print(f"  {Colors.YELLOW}!{Colors.END} {name.capitalize()}: {e}")
    
    server_status['proxy']['process'] = None
    server_status['vite']['process'] = None
    
    # Kurz warten, damit Ports freigegeben werden
    time.sleep(1)

def restart_servers():
    """Startet beide Server neu."""
    print(f"\n{Colors.CYAN}Neustart der Server...{Colors.END}\n")
    stop_servers()
    time.sleep(2)
    start_all_servers()

def start_all_servers():
    """Startet beide Server nacheinander mit ausreichend Abstand."""
    print(f"\n{Colors.CYAN}Starte Server...{Colors.END}\n")
    
    # Erst Proxy starten und warten bis er bereit ist
    start_proxy_server()
    print(f"  {Colors.YELLOW}Warte auf Proxy-Server...{Colors.END}")
    time.sleep(3)  # Mehr Zeit für Node.js Startup
    
    # Dann Vite starten
    start_vite_server()
    print(f"  {Colors.YELLOW}Warte auf Vite-Server...{Colors.END}")
    time.sleep(4)  # Vite braucht mehr Zeit zum Kompilieren
    
    print_status()

def open_browser():
    """Öffnet die App im Standard-Browser."""
    import webbrowser
    webbrowser.open('http://localhost:5173')
    print(f"  {Colors.GREEN}✓{Colors.END} Browser geöffnet")

def monitor_processes():
    """Überwacht die Prozesse im Hintergrund."""
    while True:
        for name, server in server_status.items():
            if server['process']:
                poll = server['process'].poll()
                if poll is not None:
                    server['running'] = False
        time.sleep(2)

def main():
    """Hauptfunktion."""
    print_banner()
    
    # Wechsle ins Script-Verzeichnis
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Server starten
    start_all_servers()
    print_commands()
    
    # Monitor-Thread starten
    monitor_thread = threading.Thread(target=monitor_processes, daemon=True)
    monitor_thread.start()
    
    # Auf Benutzereingaben warten
    try:
        while True:
            print(f"\n{Colors.BOLD}Eingabe:{Colors.END} ", end='', flush=True)
            try:
                cmd = input().strip().lower()
            except EOFError:
                break
                
            if cmd in ['q', 'quit', 'exit']:
                break
            elif cmd == 'r':
                restart_servers()
                print_commands()
            elif cmd == 's':
                print_status()
            elif cmd == 'o':
                open_browser()
            elif cmd == '':
                continue
            else:
                print(f"  {Colors.YELLOW}Unbekannter Befehl. Nutze Q, R, S oder O.{Colors.END}")
                
    except KeyboardInterrupt:
        pass
    
    # Aufräumen
    print(f"\n{Colors.CYAN}Beende...{Colors.END}")
    stop_servers()
    print(f"\n{Colors.GREEN}Auf Wiedersehen! 👋{Colors.END}\n")

if __name__ == '__main__':
    # Windows: ANSI-Escape-Codes aktivieren
    if os.name == 'nt':
        os.system('')
    
    try:
        main()
    except Exception as e:
        print(f"\n{Colors.RED}{Colors.BOLD}╔══════════════════════════════════════════════════════════════╗")
        print(f"║  FEHLER AUFGETRETEN                                          ║")
        print(f"╚══════════════════════════════════════════════════════════════╝{Colors.END}")
        print(f"\n{Colors.RED}{e}{Colors.END}\n")
        input("Drücke Enter zum Beenden...")
