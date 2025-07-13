import sys
import json
import requests
import socket
import threading
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from datetime import datetime
import time
import ttkbootstrap as ttk
from ttkbootstrap.constants import *
import os
import glob
from tkcalendar import DateEntry, Calendar

class ArduinoConnector:
    def __init__(self):
        self.root = ttk.Window(themename="cosmo")
        self.root.title("시럽조제기 연결 관리자")
        
        # 화면 크기 가져오기
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        
        # 창 크기를 화면의 80%로 설정
        window_width = int(screen_width * 0.8)
        window_height = int(screen_height * 0.8)
        
        # 창의 최소 크기 설정
        self.root.minsize(800, 600)
        
        # 창을 화면 중앙에 위치시키기
        x = (screen_width - window_width) // 2
        y = (screen_height - window_height) // 2
        self.root.geometry(f"{window_width}x{window_height}+{x}+{y}")
        
        self.root.bind("<F12>", self.start_dispensing)   # ← F12 누르면 조제시작
        
        # 자동 조제 상태
        self.auto_dispensing = False
        
        # 저장된 연결 정보
        self.saved_connections = {}
        self.network_prefix = None
        self.available_networks = []
        
        # 현재 연결된 기기들
        self.connected_devices = {}
        self.last_connected = None
        self.auto_reconnect_attempted = set()
        
        # 처방전 파일 경로
        self.prescription_path = self.load_prescription_path()
        
        # 파싱된 파일 목록
        self.parsed_files = set()
        
        # 파싱된 처방전 데이터 (접수번호별)
        self.parsed_prescriptions = {}
        
        # 페이지 프레임
        self.main_frame = ttk.Frame(self.root)
        self.network_frame = ttk.Frame(self.root)
        
        # UI 초기화
        self.init_main_ui()
        self.init_network_ui()
        
        # 저장된 연결 정보 로드
        self.load_connections()
        
        # 네트워크 인터페이스 감지
        self.detect_networks()
        
        # 약물명 콤보박스 초기화
        self.update_pill_name_combo()
        
        # 모든 처방전 파일 파싱 및 환자 정보 테이블 초기화
        self.parse_all_prescription_files()
        
        # 주기적인 스캔 설정
        self.schedule_scan()
        
        # 주기적인 연결 상태 확인
        self.schedule_connection_check()
        
        # 처방전 파일 모니터링 시작
        self.start_prescription_monitor()
        
        # 초기 페이지 설정
        self.show_main_page()
        
        # 약물 정보 테이블 태그 설정
        self.medicine_tree.tag_configure('connected', foreground='blue')
        self.medicine_tree.tag_configure('disconnected', foreground='red')

    def init_main_ui(self):
        """메인 페이지 UI를 초기화합니다."""
        # 처방전 파일 경로 설정 프레임
        path_frame = ttk.LabelFrame(self.main_frame, text="처방전 파일 경로 설정", bootstyle="primary")
        path_frame.pack(fill=tk.X, padx=5, pady=5)
        
        path_input_frame = ttk.Frame(path_frame)
        path_input_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.path_entry = ttk.Entry(path_input_frame)
        self.path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        if self.prescription_path:
            self.path_entry.insert(0, self.prescription_path)
        
        ttk.Button(path_input_frame, text="경로 선택", 
                  command=self.select_prescription_path,
                  style='primary.TButton').pack(side=tk.LEFT, padx=5)
        
        ttk.Button(path_input_frame, text="경로 저장", 
                  command=self.save_prescription_path,
                  style='success.TButton').pack(side=tk.LEFT, padx=5)
        
        # 날짜 선택 프레임 (Entry + 달력 버튼)
        date_frame = ttk.Frame(self.main_frame)
        date_frame.pack(fill=tk.X, padx=5, pady=5)
        ttk.Label(date_frame, text="날짜 선택:").pack(side=tk.LEFT, padx=5)
        self.date_var = tk.StringVar()
        self.date_var.set(datetime.now().strftime('%Y-%m-%d'))
        self.date_entry = ttk.Entry(date_frame, textvariable=self.date_var, width=12)
        self.date_entry.pack(side=tk.LEFT, padx=5)
        tk.Button(date_frame, text="달력", command=self.show_calendar_popup).pack(side=tk.LEFT, padx=5)
        ttk.Button(date_frame, text="조회", command=self.filter_patients_by_date, style='info.TButton').pack(side=tk.LEFT, padx=5)
        
        # 네트워크 설정 버튼
        ttk.Button(self.main_frame, text="네트워크 설정", 
                  command=self.show_network_page,
                  style='primary.TButton').pack(pady=20)
        
        # 처방전 데이터 프레임
        prescription_frame = ttk.LabelFrame(self.main_frame, text="처방전 데이터", bootstyle="primary")
        prescription_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 환자 정보 입력 프레임
        patient_input_frame = ttk.Frame(prescription_frame)
        patient_input_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # 환자 정보 입력 필드
        ttk.Label(patient_input_frame, text="환자 이름:").pack(side=tk.LEFT, padx=5)
        self.patient_name = ttk.Entry(patient_input_frame, width=20)
        self.patient_name.pack(side=tk.LEFT, padx=5)
        self.patient_name.bind('<Return>', lambda e: self.receipt_time.focus())
        
        ttk.Label(patient_input_frame, text="접수 시간:").pack(side=tk.LEFT, padx=5)
        self.receipt_time = ttk.Entry(patient_input_frame, width=20)
        self.receipt_time.pack(side=tk.LEFT, padx=5)
        self.receipt_time.bind('<Return>', lambda e: self.receipt_number.focus())
        
        ttk.Label(patient_input_frame, text="접수 번호:").pack(side=tk.LEFT, padx=5)
        self.receipt_number = ttk.Entry(patient_input_frame, width=20)
        self.receipt_number.pack(side=tk.LEFT, padx=5)
        self.receipt_number.bind('<Return>', lambda e: self.add_patient())
        
        ttk.Button(patient_input_frame, text="환자 정보 추가", 
                  command=self.add_patient,
                  style='success.TButton').pack(side=tk.LEFT, padx=5)
        
        # 환자 정보 테이블
        patient_frame = ttk.LabelFrame(prescription_frame, text="환자 정보", bootstyle="primary")
        patient_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # 환자 정보 테이블과 스크롤바를 담을 프레임
        patient_table_frame = ttk.Frame(patient_frame)
        patient_table_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 스크롤바 생성
        patient_scrollbar = ttk.Scrollbar(patient_table_frame, bootstyle="primary")
        patient_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 환자 정보 컬럼 설정
        patient_columns = ('username', 'createdat', 'receipt_number', 'transmission_status')
        self.patient_tree = ttk.Treeview(patient_table_frame, columns=patient_columns, show='headings', height=5, yscrollcommand=patient_scrollbar.set, bootstyle="primary")
        
        # 스크롤바와 테이블 연결
        patient_scrollbar.config(command=self.patient_tree.yview)
        
        # 환자 정보 컬럼 헤더 설정
        self.patient_tree.heading('username', text='환자 이름')
        self.patient_tree.heading('createdat', text='접수 시간')
        self.patient_tree.heading('receipt_number', text='접수 번호')
        self.patient_tree.heading('transmission_status', text='전송여부')
        
        # 환자 정보 컬럼 너비 설정
        self.patient_tree.column('username', width=150)
        self.patient_tree.column('createdat', width=200)
        self.patient_tree.column('receipt_number', width=100)
        self.patient_tree.column('transmission_status', width=80)
        
        self.patient_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # 환자 선택 이벤트 바인딩
        self.patient_tree.bind('<<TreeviewSelect>>', self.on_patient_select)
        
        # 약물 정보 입력 프레임
        medicine_input_frame = ttk.Frame(prescription_frame)
        medicine_input_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # 약물 정보 입력 필드
        ttk.Label(medicine_input_frame, text="약물명:").pack(side=tk.LEFT, padx=5)
        self.pill_name = ttk.Combobox(medicine_input_frame, width=15)
        self.pill_name.pack(side=tk.LEFT, padx=5)
        self.pill_name.bind('<<ComboboxSelected>>', self.on_pill_name_selected)
        
        ttk.Label(medicine_input_frame, text="약물코드:").pack(side=tk.LEFT, padx=5)
        self.pill_code = ttk.Entry(medicine_input_frame, width=10)
        self.pill_code.pack(side=tk.LEFT, padx=5)
        self.pill_code.bind('<Return>', self.on_pill_code_entered)
        
        ttk.Label(medicine_input_frame, text="1회 복용량:").pack(side=tk.LEFT, padx=5)
        self.volume = ttk.Entry(medicine_input_frame, width=10)
        self.volume.pack(side=tk.LEFT, padx=5)
        self.volume.bind('<Return>', lambda e: self.daily_intake.focus())
        
        ttk.Label(medicine_input_frame, text="일일복용횟수:").pack(side=tk.LEFT, padx=5)
        self.daily_intake = ttk.Entry(medicine_input_frame, width=10)
        self.daily_intake.pack(side=tk.LEFT, padx=5)
        self.daily_intake.bind('<Return>', lambda e: self.intake_period.focus())
        
        ttk.Label(medicine_input_frame, text="일수:").pack(side=tk.LEFT, padx=5)
        self.intake_period = ttk.Entry(medicine_input_frame, width=10)
        self.intake_period.pack(side=tk.LEFT, padx=5)
        self.intake_period.bind('<Return>', lambda e: self.add_medicine())
        
        ttk.Button(medicine_input_frame, text="약물 정보 추가", 
                  command=self.add_medicine,
                  style='success.TButton').pack(side=tk.LEFT, padx=5)
        
        # 약물 정보 테이블
        medicine_frame = ttk.LabelFrame(prescription_frame, text="약물 정보", bootstyle="primary")
        medicine_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 약물 정보 테이블과 스크롤바를 담을 프레임
        medicine_table_frame = ttk.Frame(medicine_frame)
        medicine_table_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 스크롤바 생성
        medicine_scrollbar = ttk.Scrollbar(medicine_table_frame, bootstyle="primary")
        medicine_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 약물 정보 컬럼 설정
        medicine_columns = ('pillname', 'pillcode', 'volume', 'dailyintakenumber', 'intakeperiod', 'totalvolume')
        self.medicine_tree = ttk.Treeview(medicine_table_frame, columns=medicine_columns, show='headings', height=5, yscrollcommand=medicine_scrollbar.set, bootstyle="primary")
        
        # 스크롤바와 테이블 연결
        medicine_scrollbar.config(command=self.medicine_tree.yview)
        
        # 약물 정보 컬럼 헤더 설정
        self.medicine_tree.heading('pillname', text='약물명')
        self.medicine_tree.heading('pillcode', text='약물코드')
        self.medicine_tree.heading('volume', text='1회 복용량')
        self.medicine_tree.heading('dailyintakenumber', text='일일복용횟수')
        self.medicine_tree.heading('intakeperiod', text='일수')
        self.medicine_tree.heading('totalvolume', text='전체 용량')
        
        # 약물 정보 컬럼 너비 설정
        self.medicine_tree.column('pillname', width=100)
        self.medicine_tree.column('pillcode', width=70)
        self.medicine_tree.column('volume', width=70)
        self.medicine_tree.column('dailyintakenumber', width=70)
        self.medicine_tree.column('intakeperiod', width=70)
        self.medicine_tree.column('totalvolume', width=70)
        
        self.medicine_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # 약물 정보 삭제 버튼 프레임
        medicine_button_frame = ttk.Frame(medicine_frame)
        medicine_button_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Button(medicine_button_frame, text="선택 항목 삭제", 
                  command=self.delete_selected_medicine,
                  style='danger.TButton').pack(side=tk.LEFT, padx=5)
        
        # 조제시작 버튼 프레임
        start_button_frame = ttk.Frame(medicine_frame)
        start_button_frame.pack(fill=tk.X, padx=5, pady=5)
        
        # 자동 조제 토글 버튼
        self.auto_dispense_var = tk.BooleanVar(value=False)
        self.auto_dispense_toggle = ttk.Checkbutton(
            start_button_frame, 
            text="자동 조제", 
            variable=self.auto_dispense_var,
            command=self.toggle_auto_dispensing,
            style='primary.TCheckbutton'
        )
        self.auto_dispense_toggle.pack(side=tk.LEFT, padx=5)
        
        ttk.Button(start_button_frame, text="조제시작 (F12)", 
                  command=self.start_dispensing,
                  style='success.TButton').pack(side=tk.RIGHT, padx=5)
        
        # 조제 로그 프레임
        log_frame = ttk.LabelFrame(prescription_frame, text="조제 로그", bootstyle="primary")
        log_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 로그 프레임 내부에 프레임 추가
        log_inner_frame = ttk.Frame(log_frame)
        log_inner_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 스크롤바 추가
        log_scrollbar = ttk.Scrollbar(log_inner_frame, bootstyle="primary")
        log_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 로그 텍스트 위젯
        self.log_text = tk.Text(log_inner_frame, height=10, wrap=tk.WORD, yscrollcommand=log_scrollbar.set)
        self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # 스크롤바와 텍스트 위젯 연결
        log_scrollbar.config(command=self.log_text.yview)
        
        # 로그 텍스트를 읽기 전용으로 설정
        self.log_text.config(state=tk.DISABLED)
        
        # 로그 텍스트 폰트 설정
        self.log_text.config(font=('Consolas', 10))

    def init_network_ui(self):
        """네트워크 설정 페이지 UI를 초기화합니다."""
        # 스크롤 가능한 프레임 생성
        canvas = tk.Canvas(self.network_frame)
        scrollbar = ttk.Scrollbar(self.network_frame, orient="vertical", command=canvas.yview, bootstyle="primary")
        scrollable_frame = ttk.Frame(canvas)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        # 네트워크 설정 프레임
        network_settings_frame = ttk.LabelFrame(scrollable_frame, text="네트워크 설정", bootstyle="primary")
        network_settings_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(network_settings_frame, text="네트워크:").pack(side=tk.LEFT)
        self.network_combo = ttk.Combobox(network_settings_frame)
        self.network_combo.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
        self.network_combo.bind('<<ComboboxSelected>>', lambda e: self.on_network_changed())
        
        ttk.Button(network_settings_frame, text="수동 설정", 
                  command=self.show_network_settings_dialog,
                  style='secondary.TButton').pack(side=tk.LEFT, padx=5)
        ttk.Button(network_settings_frame, text="네트워크 재검색", 
                  command=self.detect_networks,
                  style='info.TButton').pack(side=tk.LEFT, padx=5)
        
        # 발견된 기기 목록
        devices_frame = ttk.LabelFrame(scrollable_frame, text="연결가능한 시럽조제기", bootstyle="primary")
        devices_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.ip_list = tk.Listbox(devices_frame, height=10)
        self.ip_list.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 연결 정보 입력 프레임
        info_frame = ttk.Frame(devices_frame)
        info_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(info_frame, text="약품명:").pack(side=tk.LEFT, padx=5)
        self.nickname_input = ttk.Entry(info_frame, width=15)
        self.nickname_input.insert(0, "약품명 입력")
        self.nickname_input.pack(side=tk.LEFT, padx=5)
        
        ttk.Label(info_frame, text="약품 코드:").pack(side=tk.LEFT, padx=5)
        self.pill_code_input = ttk.Entry(info_frame, width=15)
        self.pill_code_input.insert(0, "약품 코드 입력")
        self.pill_code_input.pack(side=tk.LEFT, padx=5)
        
        ttk.Button(info_frame, text="저장", 
                  command=self.save_connection,
                  style='success.TButton').pack(side=tk.LEFT, padx=5)
        
        # 저장된 연결 목록
        saved_frame = ttk.LabelFrame(scrollable_frame, text="저장된 시럽조제기", bootstyle="primary")
        saved_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.saved_list = tk.Listbox(saved_frame, height=10)
        self.saved_list.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 연결 버튼들을 담을 프레임
        button_frame = ttk.Frame(saved_frame)
        button_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Button(button_frame, text="연결", 
                  command=self.connect_to_device,
                  style='success.TButton').pack(side=tk.LEFT, padx=5)
        
        ttk.Button(button_frame, text="연결 끊기", 
                  command=self.disconnect_device,
                  style='warning.TButton').pack(side=tk.LEFT, padx=5)
        
        ttk.Button(button_frame, text="삭제", 
                  command=self.delete_device,
                  style='danger.TButton').pack(side=tk.LEFT, padx=5)

        # 연결된 기기 목록
        connected_frame = ttk.LabelFrame(scrollable_frame, text="연결된 시럽조제기", bootstyle="primary")
        connected_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 연결된 기기 목록을 표시할 Treeview
        columns = ('nickname', 'pill_code', 'ip', 'status', 'last_activity')
        self.connected_tree = ttk.Treeview(connected_frame, columns=columns, show='headings', bootstyle="primary")
        
        # 컬럼 설정
        self.connected_tree.heading('nickname', text='약품명')
        self.connected_tree.heading('pill_code', text='약품 코드')
        self.connected_tree.heading('ip', text='IP 주소')
        self.connected_tree.heading('status', text='상태')
        self.connected_tree.heading('last_activity', text='마지막 활동')
        
        self.connected_tree.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 돌아가기 버튼
        ttk.Button(scrollable_frame, text="메인 화면으로 돌아가기", 
                  command=self.show_main_page,
                  style='primary.TButton').pack(pady=20)

        # 스크롤바와 캔버스 배치
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # 마우스 휠 스크롤 지원
        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1*(event.delta/120)), "units")
        canvas.bind_all("<MouseWheel>", _on_mousewheel)

    def show_main_page(self):
        """메인 페이지를 표시합니다."""
        self.network_frame.pack_forget()
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

    def show_network_page(self):
        """네트워크 설정 페이지를 표시합니다."""
        self.main_frame.pack_forget()
        self.network_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        self.detect_networks()

    def detect_networks(self):
        try:
            hostname = socket.gethostname()
            host_ips = socket.getaddrinfo(hostname, None)
            self.available_networks = []
            for host_ip in host_ips:
                if len(host_ip[4]) == 2:
                    ip = host_ip[4][0]
                    if not ip.startswith('127.'):
                        network = '.'.join(ip.split('.')[:-1]) + '.'
                        if network not in self.available_networks:
                            self.available_networks.append(network)
            if self.available_networks:
                self.network_combo['values'] = self.available_networks
                self.network_combo.set(self.available_networks[0])
                self.network_prefix = self.available_networks[0]
                self.scan_network()
            else:
                ttk.dialogs.Messagebox.show_warning("사용 가능한 네트워크를 찾을 수 없습니다.\n수동으로 설정해주세요.")
                self.show_network_settings_dialog()
        except Exception as e:
            print(f"네트워크 감지 중 오류 발생: {e}")
            ttk.dialogs.Messagebox.show_warning("네트워크 감지 중 오류가 발생했습니다.\n수동으로 설정해주세요.")
            self.show_network_settings_dialog()

    def show_network_settings_dialog(self):
        dialog = ttk.Toplevel(self.root)
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
                ttk.dialogs.Messagebox.show_error("올바른 네트워크 주소 범위를 입력하세요.", parent=dialog)
        button_frame = ttk.Frame(dialog)
        button_frame.pack(fill=tk.X, padx=20, pady=10)
        ttk.Button(button_frame, text="확인", command=on_ok, style='primary.TButton').pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="취소", command=dialog.destroy, style='secondary.TButton').pack(side=tk.LEFT, padx=5)

    def on_network_changed(self):
        self.network_prefix = self.network_combo.get()
        self.scan_network()

    def schedule_scan(self):
        self.scan_network()
        self.root.after(5000, self.schedule_scan)

    def scan_network(self):
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
        for mac, info in self.saved_connections.items():
            if mac in self.connected_devices or mac in self.auto_reconnect_attempted:
                continue
            if mac in found_devices:
                for i in range(self.saved_list.size()):
                    if mac in self.saved_list.get(i):
                        self.saved_list.selection_clear(0, tk.END)
                        self.saved_list.selection_set(i)
                        self.connect_to_device(silent=True)
                        self.auto_reconnect_attempted.add(mac)
                        break

    def connect_to_device(self, silent=False):
        """기기에 연결합니다."""
        selection = self.saved_list.curselection()
        if not selection:
            if not silent:
                ttk.dialogs.Messagebox.show_warning("연결할 기기를 선택해주세요.")
            return
            
        item_text = self.saved_list.get(selection[0])
        mac = item_text.split("(MAC: ")[1][:-1]
        
        if mac in self.connected_devices:
            if not silent:
                ttk.dialogs.Messagebox.show_info("이미 연결된 기기입니다.")
            return
            
        if mac in self.saved_connections:
            ip = self.saved_connections[mac]["ip"]
            try:
                response = requests.get(f"http://{ip}", timeout=1)
                if response.status_code == 200:
                    data = response.json()
                    if data["mac"] == mac:
                        self.connected_devices[mac] = {
                            "ip": ip,
                            "nickname": self.saved_connections[mac]["nickname"],
                            "pill_code": self.saved_connections[mac].get("pill_code", ""),
                            "status": "연결됨"
                        }
                        self.connected_tree.insert('', 'end', values=(
                            self.saved_connections[mac]["nickname"],
                            self.saved_connections[mac].get("pill_code", ""),
                            ip, "연결됨",
                            datetime.now().strftime("%H:%M:%S")))
                        if not silent:
                            ttk.dialogs.Messagebox.show_info(f"{self.saved_connections[mac]['nickname']}에 연결되었습니다.")
                        # 연결 상태 변경 시 약물 색상 업데이트
                        self.update_medicine_colors()
                        return
            except:
                pass
            for i in range(self.ip_list.size()):
                item_text = self.ip_list.get(i)
                if mac in item_text:
                    new_ip = item_text.split()[0]
                    self.saved_connections[mac]["ip"] = new_ip
                    self.connected_devices[mac] = {
                        "ip": new_ip,
                        "nickname": self.saved_connections[mac]["nickname"],
                        "pill_code": self.saved_connections[mac].get("pill_code", ""),
                        "status": "연결됨"
                    }
                    self.connected_tree.insert('', 'end', values=(
                        self.saved_connections[mac]["nickname"],
                        self.saved_connections[mac].get("pill_code", ""),
                        new_ip, "연결됨",
                        datetime.now().strftime("%H:%M:%S")))
                    if not silent:
                        ttk.dialogs.Messagebox.show_info(f"{self.saved_connections[mac]['nickname']}에 연결되었습니다.")
                    return
            if not silent:
                ttk.dialogs.Messagebox.show_warning("기기를 찾을 수 없습니다.")

    def disconnect_device(self):
        selection = self.connected_tree.selection()
        if not selection:
            ttk.dialogs.Messagebox.show_warning("연결을 끊을 기기를 선택해주세요.")
            return
        item = self.connected_tree.item(selection[0])
        ip = item['values'][2]
        nickname = item['values'][0]
        mac_to_remove = None
        for mac, info in self.connected_devices.items():
            if info['ip'] == ip:
                mac_to_remove = mac
                break
        if mac_to_remove:
            self.connected_devices[mac_to_remove]['status'] = "연결 끊김"
            self.connected_tree.delete(selection[0])
            if self.last_connected and self.last_connected.get("mac") == mac_to_remove:
                self.last_connected = None
            self.save_connections()
            # 연결 해제 시 약물 색상 업데이트
            self.update_medicine_colors()
            ttk.dialogs.Messagebox.show_info(f"{nickname}과의 연결이 해제되었습니다.")

    def save_connection(self):
        """연결 정보를 저장합니다."""
        selection = self.ip_list.curselection()
        if not selection:
            ttk.dialogs.Messagebox.show_warning("저장할 기기를 선택해주세요.")
            return
        nickname = self.nickname_input.get().strip()
        pill_code = self.pill_code_input.get().strip()
        
        if not nickname or nickname == "기기 별명 입력":
            ttk.dialogs.Messagebox.show_warning("별명을 입력해주세요.")
            return
            
        if not pill_code:
            ttk.dialogs.Messagebox.show_warning("약품코드를 입력해주세요.")
            return
            
        item_text = self.ip_list.get(selection[0])
        ip = item_text.split()[0]
        mac = item_text.split("(MAC: ")[1][:-1]
        self.saved_connections[mac] = {
            "ip": ip, 
            "nickname": nickname,
            "pill_code": pill_code
        }
        self.save_connections()
        self.update_saved_list()
        self.update_pill_name_combo()
        ttk.dialogs.Messagebox.show_info("연결 정보가 저장되었습니다.")

    def delete_device(self):
        """저장된 기기를 삭제합니다."""
        selection = self.saved_list.curselection()
        if not selection:
            ttk.dialogs.Messagebox.show_warning("삭제할 기기를 선택해주세요.")
            return
            
        item_text = self.saved_list.get(selection[0])
        mac = item_text.split("(MAC: ")[1][:-1]
        
        if mac in self.connected_devices:
            ttk.dialogs.Messagebox.show_warning("연결된 기기는 삭제할 수 없습니다. 먼저 연결을 해제해주세요.")
            return
            
        del self.saved_connections[mac]
        self.save_connections()
        self.update_saved_list()
        ttk.dialogs.Messagebox.show_info("기기가 삭제되었습니다.")

    def load_connections(self):
        """저장된 연결 정보를 로드합니다."""
        try:
            with open("connections.json", "r") as f:
                data = json.load(f)
                self.saved_connections = data.get("connections", {})
                self.last_connected = data.get("last_connected")
                
                # 기존 연결 정보에 pill_code 필드가 없는 경우 추가
                for mac, info in self.saved_connections.items():
                    if "pill_code" not in info:
                        info["pill_code"] = ""
                
            self.update_saved_list()
        except FileNotFoundError:
            pass

    def save_connections(self):
        data = {"connections": self.saved_connections, "last_connected": self.last_connected}
        with open("connections.json", "w") as f:
            json.dump(data, f)

    def update_saved_list(self):
        self.saved_list.delete(0, tk.END)
        for mac, info in self.saved_connections.items():
            self.saved_list.insert(tk.END, f"{info['nickname']} (MAC: {mac})")

    def schedule_connection_check(self):
        for item in self.connected_tree.get_children():
            values = self.connected_tree.item(item)['values']
            ip = values[2]
            current_status = values[3]  # 현재 상태 가져오기
            mac = None
            for device_mac, device_info in self.connected_devices.items():
                if device_info['ip'] == ip:
                    mac = device_mac
                    break
            
            # 조제 중인 기기는 연결 상태 확인을 건너뛰기
            if current_status == "시럽 조제 중":
                self.log_message(f"조제 중인 기기 연결 상태 확인 건너뜀: {ip}")
                continue
                
            try:
                # 연결 상태 확인을 위한 재시도 로직 추가
                response = None
                for retry in range(2):
                    try:
                        response = requests.get(f"http://{ip}", timeout=5)  # 타임아웃을 5초로 증가
                        break
                    except requests.exceptions.Timeout:
                        if retry == 0:
                            self.log_message(f"연결 상태 확인 재시도: {ip} - timeout of 5000ms exceeded")
                            time.sleep(1)  # 1초 대기 후 재시도
                        else:
                            raise
                    except Exception as e:
                        if retry == 1:
                            self.log_message(f"연결 상태 확인 실패: {ip} - {str(e)}")
                        raise
                        
                if response and response.status_code == 200:
                    data = response.json()
                    if mac and data.get("mac") == mac:
                        self.update_device_status(ip, "연결됨")
                    else:
                        self.connected_tree.delete(item)
                        if mac:
                            del self.connected_devices[mac]
                else:
                    self.update_device_status(ip, "연결 끊김")
            except Exception as e:
                self.update_device_status(ip, "연결 끊김")
                self.log_message(f"연결 상태 확인 오류: {ip} - {str(e)}")
        # 연결 상태 변경 후 약물 색상 갱신
        self.update_medicine_colors()
        self.root.after(5000, self.schedule_connection_check)

    def update_device_status(self, ip, status):
        for mac, device_info in self.connected_devices.items():
            if device_info['ip'] == ip:
                self.connected_devices[mac]['status'] = status  # 항상 status 갱신!
                # connected_tree도 갱신
                for item in self.connected_tree.get_children():
                    if self.connected_tree.item(item)['values'][2] == ip:
                        values = list(self.connected_tree.item(item)['values'])
                        values[3] = status
                        values[4] = datetime.now().strftime("%H:%M:%S")
                        self.connected_tree.item(item, values=values)
                        break
                break
        # 연결 상태 변경 시 약물 색상도 갱신
        self.update_medicine_colors()

    def send_syrup_amount(self):
        selection = self.connected_tree.selection()
        if not selection:
            ttk.dialogs.Messagebox.show_warning("시럽조제기를 선택해주세요.")
            return
        try:
            amount = int(self.syrup_amount.get())
            if amount <= 0:
                raise ValueError
        except ValueError:
            ttk.dialogs.Messagebox.show_warning("올바른 용량을 입력해주세요.")
            return
        item = self.connected_tree.item(selection[0])
        ip = item['values'][2]
        try:
            response = requests.post(f"http://{ip}/syrup", json={"amount": amount}, timeout=1)
            if response.status_code == 200:
                ttk.dialogs.Messagebox.show_info("시럽 용량이 전송되었습니다.")
                self.update_device_status(ip, "시럽 조제 중")
            else:
                ttk.dialogs.Messagebox.show_error("시럽 용량 전송에 실패했습니다.")
        except:
            ttk.dialogs.Messagebox.show_error("시럽조제기와 통신할 수 없습니다.")

    def on_patient_select(self, event):
        selection = self.patient_tree.selection()
        if not selection:
            return
        receipt_number = str(self.patient_tree.item(selection[0])['values'][2]).strip()
        # 약물 정보 테이블 초기화
        for item in self.medicine_tree.get_children():
            self.medicine_tree.delete(item)
        # 딕셔너리 키도 strip해서 비교
        for k in self.parsed_prescriptions.keys():
            if k.strip() == receipt_number:
                for medicine in self.parsed_prescriptions[k]['medicines']:
                    self.medicine_tree.insert(
                        '', 'end',
                        values=(
                            medicine['pill_name'],
                            medicine['pill_code'],
                            medicine['volume'],
                            medicine['daily'],
                            medicine['period'],
                            medicine['total']
                        ),
                        tags=('connected' if any(str(device.get('pill_code', '')) == str(medicine['pill_code']) for device in self.connected_devices.values()) else 'disconnected')
                    )
                break
        # 약물 정보 테이블 초기화 및 데이터 삽입 후
        self.update_medicine_colors()

    def add_patient(self):
        """환자 정보를 테이블에 추가합니다."""
        name = self.patient_name.get().strip()
        time = self.receipt_time.get().strip()
        number = self.receipt_number.get().strip()
        
        if not all([name, time, number]):
            ttk.dialogs.Messagebox.show_warning("모든 환자 정보를 입력해주세요.")
            return
            
        # 최근 데이터가 최상단에 위치하도록 0번 인덱스에 삽입
        self.patient_tree.insert('', 0, values=(name, time, number, ""))
        
        # 입력 필드 초기화
        self.patient_name.delete(0, tk.END)
        self.receipt_time.delete(0, tk.END)
        self.receipt_number.delete(0, tk.END)
        
        # 환자 이름 입력 필드로 포커스 이동
        self.patient_name.focus()

    def add_medicine(self):
        """약물 정보를 테이블에 추가합니다."""
        name = self.pill_name.get().strip()
        code = self.pill_code.get().strip()
        
        try:
            volume = int(self.volume.get().strip())
            daily = int(self.daily_intake.get().strip())
            period = int(self.intake_period.get().strip())
            total = volume * daily * period
        except ValueError:
            ttk.dialogs.Messagebox.show_warning("1회 복용량, 일일복용횟수, 일수는 정수로 입력해주세요.")
            return
            
        if not all([name, code]):
            ttk.dialogs.Messagebox.show_warning("약물명과 약물코드를 입력해주세요.")
            return
            
        # 현재 연결된 기기 중 해당 약품 코드와 일치하는 기기 찾기
        is_connected = False
        for device_info in self.connected_devices.values():
            if device_info.get('pill_code') == code:
                is_connected = True
                break
        
        # 약물 정보 추가 (연결 상태에 따라 태그 설정)
        item = self.medicine_tree.insert('', 'end', values=(
            name, code, volume, daily, period, total
        ), tags=('connected' if is_connected else 'disconnected'))
        
        # 입력 필드 초기화
        self.pill_name.delete(0, tk.END)
        self.pill_code.delete(0, tk.END)
        self.volume.delete(0, tk.END)
        self.daily_intake.delete(0, tk.END)
        self.intake_period.delete(0, tk.END)

    def update_medicine_colors(self):
        """약물 정보 테이블의 모든 항목의 색상을 현재 연결 상태에 따라 업데이트합니다."""
        print("=== update_medicine_colors 호출 ===")
        for item in self.medicine_tree.get_children():
            values = self.medicine_tree.item(item)['values']
            pill_code = str(values[1]).strip()
            is_connected = False
            for device_info in self.connected_devices.values():
                print(f"비교: 약물코드={pill_code}, 기기코드={str(device_info.get('pill_code', '')).strip()}, 상태={device_info.get('status', '')}")
                if (
                    str(device_info.get('pill_code', '')).strip() == pill_code
                    and device_info.get('status', '') == '연결됨'
                ):
                    is_connected = True
                    break
            print(f"약물코드 {pill_code} -> {'파랑' if is_connected else '빨강'}")
            self.medicine_tree.item(item, tags=('connected' if is_connected else 'disconnected'))

    def log_message(self, message):
        """로그 메시지를 추가합니다."""
        try:
            self.log_text.config(state=tk.NORMAL)
            self.log_text.insert(tk.END, f"{datetime.now().strftime('%H:%M:%S')} - {message}\n")
            self.log_text.see(tk.END)  # 스크롤을 최신 메시지로 이동
            self.log_text.config(state=tk.DISABLED)
            print(f"로그 메시지: {message}")  # 디버깅을 위한 콘솔 출력
        except Exception as e:
            print(f"로그 메시지 출력 중 오류 발생: {str(e)}")

    def start_dispensing(self, event=None):
        """연결된 약물의 총량을 해당 기기에 전송합니다."""
        # 현재 선택된 환자 정보 가져오기
        selected_patients = self.patient_tree.selection()
        if not selected_patients:
            message = "환자를 선택해주세요."
            self.log_message(message)
            ttk.dialogs.Messagebox.show_warning("경고", message)
            return
            
        receipt_number = self.patient_tree.item(selected_patients[0])['values'][2]
        
        # 연결된 기기 목록 가져오기
        connected_devices = self.connected_devices
        
        if not connected_devices:
            message = "연결된 시럽조제기가 없습니다."
            self.log_message(message)
            ttk.dialogs.Messagebox.show_warning("연결된 시럽조제기가 없습니다.", message)
            return
            
        # 디버깅을 위한 로그 추가
        self.log_message(f"연결된 기기 목록: {connected_devices}")
        
        # 모든 약물 전송 성공 여부를 추적
        all_success = True
            
        # 약물 정보 테이블의 모든 항목 확인
        for item in self.medicine_tree.get_children():
            values = self.medicine_tree.item(item)['values']
            pill_name = values[0]
            pill_code = str(values[1])  # 문자열로 변환
            total_volume = values[5]  # 전체 용량
            
            # 연결된 약물인지 확인 (파란색으로 표시된 약물만 처리)
            is_connected = False
            connected_device_info = None
            for device_info in connected_devices.values():
                if str(device_info.get('pill_code', '')) == pill_code:
                    if device_info.get('status', '') == '연결됨':
                        is_connected = True
                        connected_device_info = device_info
                    break
            
            if not is_connected:
                self.log_message(f"{pill_name}은(는) 연결되지 않은 약물이므로 건너뜁니다.")
                all_success = False
                continue
            
            # 디버깅을 위한 로그 추가
            self.log_message(f"처리 중인 약물: {pill_name}, 코드: {pill_code}, 총량: {total_volume}")
            
            # 연결된 기기 중 해당 약품 코드와 일치하는 기기 찾기
            device_found = False
            for mac, device_info in connected_devices.items():
                device_pill_code = str(device_info.get('pill_code', ''))  # 문자열로 변환
                if device_pill_code == pill_code and device_info.get('status', '') == '연결됨':
                    device_found = True
                    ip = device_info['ip']
                    
                    # 조제 시작 전에 상태를 "시럽 조제 중"으로 변경
                    self.update_device_status(ip, "시럽 조제 중")
                    self.log_message(f"{pill_name} 조제 시작 - 기기 상태를 '시럽 조제 중'으로 변경")
                    
                    # 최대 3번까지 재시도
                    max_retries = 3
                    retry_count = 0
                    success = False
                    
                    while retry_count < max_retries and not success:
                        try:
                            # 총량을 기기에 전송 (TV 접두사와 FF FF FF 종료 신호 추가)
                            data = f"TV{total_volume} FF FF FF"
                            headers = {
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            }
                            response = requests.post(f"http://{ip}/dispense", 
                                                  json={"amount": data},
                                                  headers=headers,
                                                  timeout=10)  # 타임아웃을 10초로 증가
                            
                            # 응답 상세 정보 로깅
                            self.log_message(f"응답 상태 코드: {response.status_code}")
                            self.log_message(f"응답 내용: {response.text}")
                            
                            # ESP32의 응답 확인
                            if response.status_code == 200 or "OK" in response.text:
                                message = f"{pill_name} 총량 전달 성공"
                                self.log_message(message)
                                success = True
                            else:
                                message = f"{pill_name} 총량 전달 실패 (시도 {retry_count + 1}/{max_retries})"
                                self.log_message(message)
                                retry_count += 1
                                if retry_count < max_retries:
                                    self.log_message("3초 후 재시도합니다...")
                                    time.sleep(3)  # 3초 대기 후 재시도
                        except requests.exceptions.Timeout as e:
                            message = f"{pill_name} 총량 전달 중 오류: timeout of 10000ms exceeded"
                            self.log_message(message)
                            retry_count += 1
                            if retry_count < max_retries:
                                self.log_message("3초 후 재시도합니다...")
                                time.sleep(3)
                        except requests.exceptions.ConnectionError as e:
                            message = f"{pill_name} 연결 오류 (시도 {retry_count + 1}/{max_retries}): {str(e)}"
                            self.log_message(message)
                            retry_count += 1
                            if retry_count < max_retries:
                                self.log_message("3초 후 재시도합니다...")
                                time.sleep(3)
                        except Exception as e:
                            message = f"{pill_name} 총량 전달 중 오류: {str(e)}"
                            self.log_message(message)
                            retry_count += 1
                            if retry_count < max_retries:
                                self.log_message("3초 후 재시도합니다...")
                                time.sleep(3)
                            else:
                                ttk.dialogs.Messagebox.show_error("오류", message)
                                break
                    
                    if not success:
                        message = f"{pill_name} 총량 전달 실패 (최대 재시도 횟수 초과)"
                        self.log_message(message)
                        ttk.dialogs.Messagebox.show_error("오류", message)
                        all_success = False
                        # 실패 시 상태를 다시 "연결됨"으로 복원
                        self.update_device_status(ip, "연결됨")
                        self.log_message(f"{pill_name} 조제 실패 - 기기 상태를 '연결됨'으로 복원")
                    else:
                        # 성공 시에도 일정 시간 후 상태를 "연결됨"으로 복원 (조제 완료 후)
                        def restore_status():
                            self.update_device_status(ip, "연결됨")
                            self.log_message(f"{pill_name} 조제 완료 - 기기 상태를 '연결됨'으로 복원")
                        # 30초 후에 상태 복원 (조제 시간을 고려)
                        self.root.after(30000, restore_status)
                    break  # 일치하는 기기를 찾았으면 다음 약물로 넘어감
            
            if not device_found:
                message = f"{pill_name}에 연결된 시럽조제기가 없습니다."
                self.log_message(message)
                ttk.dialogs.Messagebox.show_warning("경고", message)
                all_success = False
        
        # 모든 약물 전송이 성공적으로 완료되었는지 확인하고 상태 업데이트
        if all_success:
            self.update_transmission_status(receipt_number, "완료")
        else:
            self.update_transmission_status(receipt_number, "실패")

    def delete_selected_medicine(self):
        """선택된 약물 정보를 삭제합니다."""
        selected_items = self.medicine_tree.selection()
        if not selected_items:
            ttk.dialogs.Messagebox.show_warning("삭제할 약물을 선택해주세요.")
            return
            
        for item in selected_items:
            values = self.medicine_tree.item(item)['values']
            pill_name = values[0]
            self.medicine_tree.delete(item)
            self.log_message(f"약물 '{pill_name}'이(가) 삭제되었습니다.")
            
        ttk.dialogs.Messagebox.show_info("선택된 약물이 삭제되었습니다.")

    def on_pill_code_entered(self, event):
        """약품코드 입력 시 해당 시럽조제기의 별명을 약물명에 자동 입력합니다."""
        pill_code = self.pill_code.get().strip()
        
        # 저장된 연결 정보에서 해당 약품코드와 일치하는 시럽조제기 찾기
        for device_info in self.saved_connections.values():
            if device_info.get('pill_code') == pill_code:
                # 약물명 입력 필드에 시럽조제기 별명 입력
                self.pill_name.delete(0, tk.END)
                self.pill_name.insert(0, device_info['nickname'])
                break
        
        # 다음 입력 필드로 포커스 이동
        self.volume.focus()

    def update_pill_name_combo(self):
        """저장된 시럽조제기 목록을 콤보박스에 업데이트합니다."""
        pill_names = []
        for device_info in self.saved_connections.values():
            if device_info.get('nickname') and device_info.get('nickname') not in pill_names:
                pill_names.append(device_info['nickname'])
        self.pill_name['values'] = sorted(pill_names)

    def on_pill_name_selected(self, event):
        """약물명이 선택되었을 때 해당하는 약물코드를 자동으로 채웁니다."""
        selected_name = self.pill_name.get()
        for device_info in self.saved_connections.values():
            if device_info.get('nickname') == selected_name:
                self.pill_code.delete(0, tk.END)
                self.pill_code.insert(0, device_info.get('pill_code', ''))
                break
        self.volume.focus()

    def select_prescription_path(self):
        """처방전 파일 경로를 선택합니다."""
        path = filedialog.askdirectory()
        if path:
            self.path_entry.delete(0, tk.END)
            self.path_entry.insert(0, path)
            self.prescription_path = path
            self.save_prescription_path()

    def save_prescription_path(self):
        """처방전 파일 경로를 저장합니다."""
        path = self.path_entry.get().strip()
        if path and os.path.exists(path):
            self.prescription_path = path
            with open("prescription_path.txt", "w") as f:
                f.write(path)
            ttk.dialogs.Messagebox.show_info("처방전 파일 경로가 저장되었습니다.")
        else:
            ttk.dialogs.Messagebox.show_warning("올바른 경로를 입력해주세요.")

    def load_prescription_path(self):
        """저장된 처방전 파일 경로를 로드합니다."""
        try:
            with open("prescription_path.txt", "r") as f:
                return f.read().strip()
        except:
            return ""

    def start_prescription_monitor(self):
        """처방전 파일을 모니터링합니다."""
        if not self.prescription_path:
            return
            
        def monitor():
            while True:
                try:
                    # 가장 최근 파일 찾기
                    files = glob.glob(os.path.join(self.prescription_path, "*.txt"))
                    if files:
                        latest_file = max(files, key=os.path.getctime)
                        # 아직 파싱하지 않은 파일인 경우에만 파싱
                        if latest_file not in self.parsed_files:
                            self.parse_prescription_file(latest_file)
                            self.parsed_files.add(latest_file)
                except Exception as e:
                    print(f"파일 모니터링 중 오류 발생: {e}")
                time.sleep(5)  # 5초마다 확인
        
        thread = threading.Thread(target=monitor, daemon=True)
        thread.start()

    def parse_prescription_file(self, file_path):
        """처방전 파일을 파싱합니다."""
        try:
            # 이미 파싱된 파일인지 확인
            if file_path in self.parsed_files:
                return
                
            # cp949 인코딩으로 파일 읽기 시도
            try:
                with open(file_path, 'r', encoding='cp949') as f:
                    lines = f.readlines()
            except UnicodeDecodeError:
                # cp949로 실패하면 euc-kr 시도
                with open(file_path, 'r', encoding='euc-kr') as f:
                    lines = f.readlines()
                
            if not lines:
                return
                
            # 파일명에서 접수번호 추출
            receipt_number = os.path.basename(file_path).split('.')[0]
            
            # 환자 이름 파싱
            patient_name = lines[0].strip()
            
            # 접수 시간 생성 (파일명의 날짜 부분 사용)
            receipt_time = f"{receipt_number[:4]}-{receipt_number[4:6]}-{receipt_number[6:8]}"
            
            # 약물 정보 파싱
            medicine_data = []
            for line in lines[1:]:
                if not line.strip():
                    continue
                parts = line.strip().split('\\')
                if len(parts) >= 8:
                    medicine_data.append({
                        'pill_code': parts[0],
                        'pill_name': parts[1],
                        'volume': int(parts[2]),
                        'daily': int(parts[3]),
                        'period': int(parts[4]),
                        'total': int(parts[5]),
                        'date': parts[6],
                        'line_number': int(parts[7])
                    })
            # 처방전줄수 기준으로 정렬
            medicine_data.sort(key=lambda x: x['line_number'])
            # 파싱된 데이터 저장
            self.parsed_prescriptions[receipt_number] = {
                'patient': {
                    'name': patient_name,
                    'receipt_time': receipt_time,
                    'receipt_number': receipt_number
                },
                'medicines': medicine_data
            }
            # 환자 정보 테이블에 추가 (중복 방지)
            already_exists = False
            for item in self.patient_tree.get_children():
                values = self.patient_tree.item(item)['values']
                if str(values[2]) == receipt_number:
                    already_exists = True
                    break
            if not already_exists:
                self.patient_tree.insert('', 0, values=(patient_name, receipt_time, receipt_number, ""))
                # 자동 조제가 활성화되어 있다면 자동으로 조제 시작
                if self.auto_dispensing:
                    self.log_message(f"새로운 처방전 '{os.path.basename(file_path)}'이(가) 감지되어 자동으로 조제를 시작합니다.")
                    self.start_dispensing()
            # 파싱된 파일 목록에 추가
            self.parsed_files.add(file_path)
            # 로그 메시지 추가
            self.log_message(f"처방전 파일 '{os.path.basename(file_path)}' 파싱 완료")
        except Exception as e:
            error_msg = f"파일 파싱 중 오류 발생: {str(e)}"
            print(error_msg)
            self.log_message(error_msg)

    def parse_all_prescription_files(self):
        """처방전 폴더 내 모든 txt 파일을 파싱하여 오늘 날짜의 환자 정보만 테이블에 표시합니다."""
        if not self.prescription_path:
            return
        files = glob.glob(os.path.join(self.prescription_path, "*.txt"))
        for file_path in files:
            self.parse_prescription_file(file_path)
        # 오늘 날짜로 필터링하여 표시
        if hasattr(self, 'date_var'):
            self.filter_patients_by_date()
        else:
            today = datetime.now().strftime('%Y-%m-%d')
            for item in self.patient_tree.get_children():
                self.patient_tree.delete(item)
            for pres in self.parsed_prescriptions.values():
                patient = pres['patient']
                if patient['receipt_time'] == today:
                    self.patient_tree.insert('', 0, values=(patient['name'], patient['receipt_time'], patient['receipt_number'], ""))

    def filter_patients_by_date(self):
        selected_date = self.date_var.get()
        for item in self.patient_tree.get_children():
            self.patient_tree.delete(item)
        for pres in self.parsed_prescriptions.values():
            patient = pres['patient']
            if patient['receipt_time'] == selected_date:
                self.patient_tree.insert('', 0, values=(patient['name'], patient['receipt_time'], patient['receipt_number'], ""))

    def show_calendar_popup(self):
        # 별도의 Toplevel 인스턴스 생성
        cal_root = tk.Toplevel(self.root)
        cal_root.title("날짜 선택")
        cal_root.geometry("300x250")
        cal = Calendar(
            cal_root,
            date_pattern='yyyy-mm-dd',
            background='white',
            foreground='black',
            selectbackground='blue',
            selectforeground='white'
        )
        cal.pack(padx=10, pady=10, fill='both', expand=True)
        def set_date():
            self.date_var.set(cal.get_date())
            cal_root.destroy()
            self.filter_patients_by_date()  # 날짜 선택 후 환자 정보 필터링
        tk.Button(cal_root, text="확인", command=set_date).pack(pady=5)

    def toggle_auto_dispensing(self):
        """자동 조제 상태를 토글합니다."""
        self.auto_dispensing = self.auto_dispense_var.get()
        status = "활성화" if self.auto_dispensing else "비활성화"
        self.log_message(f"자동 조제 기능이 {status}되었습니다.")

    def update_transmission_status(self, receipt_number, status):
        """환자의 전송 상태를 업데이트합니다."""
        for item in self.patient_tree.get_children():
            values = self.patient_tree.item(item)['values']
            if str(values[2]) == str(receipt_number):
                values = list(values)
                values[3] = status
                self.patient_tree.item(item, values=values)
                break

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    app = ArduinoConnector()
    app.run()
