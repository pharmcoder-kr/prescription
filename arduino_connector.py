import sys
import json
import requests
import socket
import threading
import tkinter as tk
from tkinter import ttk, messagebox

class ArduinoConnector:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("아두이노 연결 관리자")
        self.root.geometry("800x600")
        
        # 저장된 연결 정보
        self.saved_connections = {}
        self.current_ip = None
        self.network_prefix = None
        self.available_networks = []
        
        # 현재 연결 상태 초기화
        self.current_device = None
        
        # UI 초기화
        self.init_ui()
        
        # 저장된 연결 정보 로드
        self.load_connections()
        
        # 네트워크 인터페이스 감지
        self.detect_networks()
        
        # 주기적인 스캔 설정
        self.schedule_scan()
        
        # 주기적인 연결 상태 확인
        self.schedule_connection_check()
        
        # 마지막 연결 상태 복원
        self.restore_last_connection()

    def init_ui(self):
        # 네트워크 선택 프레임
        network_frame = ttk.Frame(self.root)
        network_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(network_frame, text="네트워크:").pack(side=tk.LEFT)
        self.network_combo = ttk.Combobox(network_frame)
        self.network_combo.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        self.network_combo.bind('<<ComboboxSelected>>', lambda e: self.on_network_changed())
        
        ttk.Button(network_frame, text="수동 설정", 
                  command=self.show_network_settings_dialog).pack(side=tk.LEFT, padx=5)
        ttk.Button(network_frame, text="네트워크 재검색", 
                  command=self.detect_networks).pack(side=tk.LEFT, padx=5)

        # 발견된 기기 목록
        ttk.Label(self.root, text="발견된 아두이노 기기:").pack(anchor=tk.W, padx=5)
        self.ip_list = tk.Listbox(self.root, height=6)
        self.ip_list.pack(fill=tk.X, padx=5, pady=5)

        # 연결 정보 입력 프레임
        info_frame = ttk.Frame(self.root)
        info_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.nickname_input = ttk.Entry(info_frame)
        self.nickname_input.insert(0, "기기 별명 입력")
        self.nickname_input.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        
        ttk.Button(info_frame, text="저장", 
                  command=self.save_connection).pack(side=tk.LEFT, padx=5)

        # 저장된 연결 목록
        ttk.Label(self.root, text="저장된 연결:").pack(anchor=tk.W, padx=5)
        self.saved_list = tk.Listbox(self.root, height=6)
        self.saved_list.pack(fill=tk.X, padx=5, pady=5)

        # 연결 버튼들을 담을 프레임
        button_frame = ttk.Frame(self.root)
        button_frame.pack(pady=5)
        
        # 연결 버튼
        ttk.Button(button_frame, text="연결", 
                  command=self.connect_to_device).pack(side=tk.LEFT, padx=5)
        
        # 연결 끊기 버튼
        self.disconnect_btn = ttk.Button(button_frame, text="연결 끊기", 
                                       command=self.disconnect_device, state='disabled')
        self.disconnect_btn.pack(side=tk.LEFT, padx=5)

        # 현재 연결 상태를 표시하는 프레임 추가
        status_frame = ttk.Frame(self.root)
        status_frame.pack(fill=tk.X, padx=5, pady=10)
        
        ttk.Label(status_frame, text="현재 연결 상태:").pack(side=tk.LEFT, padx=5)
        self.connection_status = ttk.Label(status_frame, text="연결되지 않음", foreground="gray")
        self.connection_status.pack(side=tk.LEFT, padx=5)

    def detect_networks(self):
        """사용 가능한 네트워크 인터페이스를 감지합니다."""
        try:
            hostname = socket.gethostname()
            host_ips = socket.getaddrinfo(hostname, None)
            
            self.available_networks = []
            for host_ip in host_ips:
                if len(host_ip[4]) == 2:  # IPv4 주소만 처리
                    ip = host_ip[4][0]
                    if not ip.startswith('127.'):  # 로컬호스트 제외
                        network = '.'.join(ip.split('.')[:-1]) + '.'
                        if network not in self.available_networks:
                            self.available_networks.append(network)
            
            if self.available_networks:
                self.network_combo['values'] = self.available_networks
                self.network_combo.set(self.available_networks[0])
                self.network_prefix = self.available_networks[0]
                print(f"감지된 네트워크: {self.available_networks}")
                self.scan_network()
            else:
                messagebox.showwarning("경고", "사용 가능한 네트워크를 찾을 수 없습니다.\n수동으로 설정해주세요.")
                self.show_network_settings_dialog()
                
        except Exception as e:
            print(f"네트워크 감지 중 오류 발생: {e}")
            messagebox.showwarning("경고", "네트워크 감지 중 오류가 발생했습니다.\n수동으로 설정해주세요.")
            self.show_network_settings_dialog()

    def show_network_settings_dialog(self):
        """네트워크 설정을 수동으로 입력받는 다이얼로그를 표시합니다."""
        dialog = tk.Toplevel(self.root)
        dialog.title("네트워크 설정")
        dialog.geometry("300x150")
        
        ttk.Label(dialog, text="네트워크 주소 범위를 입력하세요\n(예: 192.168.1.)").pack(pady=10)
        ip_input = ttk.Entry(dialog)
        ip_input.pack(fill=tk.X, padx=20, pady=5)
        
        def on_ok():
            prefix = ip_input.get().strip()
            if prefix and prefix.endswith('.'):
                self.network_prefix = prefix
                if prefix not in self.available_networks:
                    self.available_networks.append(prefix)
                    self.network_combo['values'] = self.available_networks
                self.network_combo.set(prefix)
                dialog.destroy()
                self.scan_network()
            else:
                messagebox.showwarning("오류", "올바른 네트워크 주소 범위를 입력하세요.", parent=dialog)
        
        button_frame = ttk.Frame(dialog)
        button_frame.pack(fill=tk.X, padx=20, pady=10)
        ttk.Button(button_frame, text="확인", command=on_ok).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="취소", 
                  command=dialog.destroy).pack(side=tk.LEFT, padx=5)

    def on_network_changed(self):
        """네트워크 선택이 변경되었을 때 호출됩니다."""
        self.network_prefix = self.network_combo.get()
        self.scan_network()

    def schedule_scan(self):
        """주기적인 스캔을 예약합니다."""
        self.scan_network()
        self.root.after(5000, self.schedule_scan)  # 5초마다 스캔

    def scan_network(self):
        """네트워크에서 아두이노 기기를 스캔합니다."""
        if not self.network_prefix:
            return
            
        self.ip_list.delete(0, tk.END)
        
        def check_ip(ip):
            try:
                response = requests.get(f"http://{ip}", timeout=1)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("status") == "ready":
                        return data
            except:
                pass
            return None

        results = {}
        threads = []
        
        for i in range(1, 255):
            ip = f"{self.network_prefix}{i}"
            thread = threading.Thread(target=lambda ip=ip: results.update({ip: check_ip(ip)}))
            thread.start()
            threads.append(thread)
            
        for thread in threads:
            thread.join()
            
        found_devices = {}
        for ip, data in results.items():
            if data:
                mac = data['mac']
                found_devices[mac] = ip
                self.ip_list.insert(tk.END, f"{ip} (MAC: {mac})")
        
        # 연결이 끊어진 상태에서 이전에 연결된 기기가 발견되면 자동 재연결
        if (self.current_device is None and self.last_connected and 
            self.last_connected.get("mac") in found_devices):
            mac = self.last_connected["mac"]
            if mac in self.saved_connections:
                print(f"이전 연결 기기 {self.saved_connections[mac]['nickname']} 발견, 자동 재연결 시도...")
                # 저장된 기기 목록에서 해당 항목 선택
                for i in range(self.saved_list.size()):
                    if mac in self.saved_list.get(i):
                        self.saved_list.selection_clear(0, tk.END)
                        self.saved_list.selection_set(i)
                        # 자동 재연결 시도
                        self.connect_to_device(silent=True)
                        break

    def save_connection(self):
        """현재 선택된 연결을 저장합니다."""
        selection = self.ip_list.curselection()
        if not selection:
            messagebox.showwarning("경고", "저장할 기기를 선택해주세요.")
            return
            
        nickname = self.nickname_input.get().strip()
        if not nickname or nickname == "기기 별명 입력":
            messagebox.showwarning("경고", "별명을 입력해주세요.")
            return
            
        item_text = self.ip_list.get(selection[0])
        ip = item_text.split()[0]
        mac = item_text.split("(MAC: ")[1][:-1]
        
        self.saved_connections[mac] = {
            "ip": ip,
            "nickname": nickname
        }
        
        self.save_connections()
        self.update_saved_list()
        messagebox.showinfo("성공", "연결 정보가 저장되었습니다.")

    def load_connections(self):
        """저장된 연결 정보를 로드합니다."""
        try:
            with open("connections.json", "r") as f:
                data = json.load(f)
                self.saved_connections = data.get("connections", {})
                self.last_connected = data.get("last_connected")
            self.update_saved_list()
        except FileNotFoundError:
            self.last_connected = None
            pass

    def save_connections(self):
        """연결 정보와 현재 연결 상태를 파일에 저장합니다."""
        data = {
            "connections": self.saved_connections,
            "last_connected": {
                "mac": self.current_device,
                "ip": self.current_ip
            } if self.current_device else None
        }
        with open("connections.json", "w") as f:
            json.dump(data, f)

    def update_saved_list(self):
        """저장된 연결 목록을 업데이트합니다."""
        self.saved_list.delete(0, tk.END)
        for mac, info in self.saved_connections.items():
            self.saved_list.insert(tk.END, f"{info['nickname']} (MAC: {mac})")

    def disconnect_device(self):
        """현재 연결된 기기와의 연결을 끊습니다."""
        if self.current_ip:
            self.current_ip = None
            self.current_device = None
            self.connection_status.config(text="연결되지 않음", foreground="gray")
            self.disconnect_btn.config(state='disabled')
            # 연결 해제 시에도 상태 저장
            self.save_connections()
            messagebox.showinfo("알림", "연결이 해제되었습니다.")

    def connect_to_device(self, silent=False):
        """선택된 기기에 연결을 시도합니다."""
        selection = self.saved_list.curselection()
        if not selection:
            if not silent:
                messagebox.showwarning("경고", "연결할 기기를 선택해주세요.")
            return
            
        item_text = self.saved_list.get(selection[0])
        mac = item_text.split("(MAC: ")[1][:-1]
        
        if mac in self.saved_connections:
            ip = self.saved_connections[mac]["ip"]
            try:
                response = requests.get(f"http://{ip}", timeout=1)
                if response.status_code == 200:
                    data = response.json()
                    if data["mac"] == mac:
                        self.current_ip = ip
                        self.current_device = mac
                        # 연결 상태 업데이트
                        self.connection_status.config(
                            text=f"{self.saved_connections[mac]['nickname']} ({ip})",
                            foreground="green"
                        )
                        # 연결 끊기 버튼 활성화
                        self.disconnect_btn.config(state='normal')
                        # 연결 성공 시 상태 저장
                        self.save_connections()
                        if not silent:
                            messagebox.showinfo("성공", 
                                f"{self.saved_connections[mac]['nickname']}에 연결되었습니다.")
                        return
            except:
                pass
                
            # 저장된 IP로 연결 실패 시, 네트워크 스캔으로 IP 찾기
            self.scan_network()
            for i in range(self.ip_list.size()):
                item_text = self.ip_list.get(i)
                if mac in item_text:
                    new_ip = item_text.split()[0]
                    self.saved_connections[mac]["ip"] = new_ip
                    self.current_ip = new_ip
                    self.current_device = mac
                    # 연결 상태 업데이트
                    self.connection_status.config(
                        text=f"{self.saved_connections[mac]['nickname']} ({new_ip})",
                        foreground="green"
                    )
                    # 연결 끊기 버튼 활성화
                    self.disconnect_btn.config(state='normal')
                    # 연결 성공 시 상태 저장
                    self.save_connections()
                    if not silent:
                        messagebox.showinfo("성공", 
                            f"{self.saved_connections[mac]['nickname']}에 연결되었습니다.")
                    return
                    
            # 연결 실패 시 상태 업데이트
            self.current_ip = None
            self.current_device = None
            self.connection_status.config(text="연결되지 않음", foreground="red")
            self.disconnect_btn.config(state='disabled')
            # 연결 실패 시에도 상태 저장
            self.save_connections()
            if not silent:
                messagebox.showwarning("오류", "기기를 찾을 수 없습니다.")

    def schedule_connection_check(self):
        """주기적으로 현재 연결된 기기의 상태를 확인합니다."""
        if self.current_ip and self.current_device:
            try:
                response = requests.get(f"http://{self.current_ip}", timeout=1)
                if response.status_code != 200:
                    self.connection_status.config(text="연결이 끊어짐", foreground="red")
                    self.disconnect_btn.config(state='disabled')
                    # 연결이 끊어질 때 last_connected 정보 저장
                    self.last_connected = {
                        "mac": self.current_device,
                        "ip": self.current_ip
                    }
                    self.current_ip = None
                    self.current_device = None
                    self.save_connections()
            except:
                self.connection_status.config(text="연결이 끊어짐", foreground="red")
                self.disconnect_btn.config(state='disabled')
                # 연결이 끊어질 때 last_connected 정보 저장
                self.last_connected = {
                    "mac": self.current_device,
                    "ip": self.current_ip
                }
                self.current_ip = None
                self.current_device = None
                self.save_connections()
        
        # 5초마다 연결 상태 확인
        self.root.after(5000, self.schedule_connection_check)

    def restore_last_connection(self):
        """마지막으로 연결된 기기에 자동으로 재연결을 시도합니다."""
        if hasattr(self, 'last_connected') and self.last_connected:
            mac = self.last_connected.get("mac")
            if mac in self.saved_connections:
                print(f"마지막 연결 기기 {self.saved_connections[mac]['nickname']}에 재연결 시도 중...")
                # 저장된 기기 목록에서 해당 항목 선택
                for i in range(self.saved_list.size()):
                    if mac in self.saved_list.get(i):
                        self.saved_list.selection_clear(0, tk.END)
                        self.saved_list.selection_set(i)
                        # 연결 시도 (silent=True로 설정하여 팝업 메시지 억제)
                        self.connect_to_device(silent=True)
                        break

    def run(self):
        """프로그램을 실행합니다."""
        self.root.mainloop()

if __name__ == "__main__":
    app = ArduinoConnector()
    app.run() 