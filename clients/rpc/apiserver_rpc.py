#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ApiServer RPC 调用封装
统一处理认证、重试、错误处理

认证方式：通过 X-Client-Secret 请求头传递用户秘钥
"""

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


@dataclass
class Task:
    """任务数据模型"""
    id: int
    key: str
    title: str
    desc: str
    status: str
    status_text: str
    client_id: Optional[int]  # 可为 None，表示未分配客户端
    client_name: Optional[str]
    type: str
    flow: Dict[str, Any]
    flow_status: str
    created_at: Optional[str]
    updated_at: Optional[str]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Task':
        """从字典创建 Task 对象"""
        return cls(
            id=data.get('id', 0),
            key=data.get('key', ''),
            title=data.get('title', ''),
            desc=data.get('desc', ''),
            status=data.get('status', ''),
            status_text=data.get('status_text', ''),
            client_id=data.get('client_id'),  # 可为 None
            client_name=data.get('client_name'),
            type=data.get('type', ''),
            flow=data.get('flow', {}),
            flow_status=data.get('flow_status', ''),
            created_at=data.get('created_at'),
            updated_at=data.get('updated_at'),
        )


class ApiServerRpc:
    """ApiServer RPC 客户端（使用 Secret 秘钥认证）"""
    
    def __init__(self, base_url: str, secret: str, client_id: int, instance_uuid: str = None):
        """
        初始化 RPC 客户端

        Args:
            base_url: API 服务器地址
            secret: 用户秘钥（用于 X-Client-Secret 认证）
            client_id: 客户端 ID
            instance_uuid: 客户端实例UUID
        """
        self.base_url = base_url.rstrip('/')
        self.secret = secret
        self.client_id = client_id
        self.instance_uuid = instance_uuid
        self._timeout = 3

    def _get_headers(self) -> Dict[str, str]:
        """获取请求头"""
        headers = {
            'Content-Type': 'application/json',
            'traceId': str(uuid.uuid4()),  # 每次请求生成唯一的 traceId
            'X-Client-Secret': self.secret,  # 秘钥认证
            'X-Client-ID': str(self.client_id)  # 客户端ID
        }
        if self.instance_uuid:
            headers['X-Instance-UUID'] = self.instance_uuid
        return headers
    
    def _request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        _network_retry_count: int = 0
    ) -> Dict[str, Any]:
        """
        发送请求（内部方法）
        
        Args:
            method: HTTP 方法
            endpoint: API 端点（如 /api/task）
            json_data: JSON 请求体
            params: URL 查询参数
            _network_retry_count: 网络异常重试次数（内部使用）
            
        Returns:
            响应数据
            
        Raises:
            ApiException: API 调用失败
        """
        url = f"{self.base_url}{endpoint}"
        max_network_retries = 10
        
        try:
            response = requests.request(
                method=method,
                url=url,
                json=json_data,
                params=params,
                headers=self._get_headers(),
                timeout=self._timeout
            )
            
            # 尝试解析 JSON 响应
            try:
                data = response.json()
            except (ValueError, requests.exceptions.JSONDecodeError) as json_err:
                # JSON 解析失败，记录响应内容用于调试
                content_preview = response.text[:500] if response.text else "(空响应)"
                logger.error(
                    f"JSON 解析失败 [{method}] {endpoint}: {json_err}, "
                    f"HTTP状态码: {response.status_code}, "
                    f"响应内容预览: {content_preview}"
                )
                raise ApiException(
                    response.status_code,
                    f"服务器返回非 JSON 响应: {json_err}"
                )
            
            # 检查业务状态码
            if response.status_code >= 400:
                logger.error(
                    f"API调用失败 [{method}] {url}, "
                    f"params={params}, body={json_data}, "
                    f"HTTP状态码: {response.status_code}, "
                    f"响应: {data.get('message', '请求失败')}"
                )
                raise ApiException(
                    response.status_code,
                    data.get('message', '请求失败')
                )
            
            return data
            
        except requests.RequestException as e:
            # 网络异常重试逻辑：最多重试3次，每次间隔10秒
            if _network_retry_count < max_network_retries:
                next_retry = _network_retry_count + 1
                sleep_seconds = 10
                logger.warning(
                    f"网络异常 [{method}] {endpoint}: {e}，"
                    f"第 {next_retry}/{max_network_retries} 次重试..."
                )
                time.sleep(sleep_seconds)
                return self._request(
                    method, endpoint, json_data, params,
                    _network_retry_count=next_retry
                )
            
            logger.error(f"请求异常 [{method}] {endpoint}: {e}，已达到最大重试次数")
            raise ApiException(0, f"请求异常: {e}")
    
    # ==================== 用户相关 API ====================
    
    def get_current_user(self) -> Dict[str, Any]:
        """
        获取当前登录用户信息
        
        Returns:
            用户信息
        """
        return self._request('GET', '/api/user/me')
    
    # ==================== 任务相关 API ====================
        
    def get_running_tasks(self, client_id: int) -> List[Task]:
        """
        获取状态为进行中的任务列表
        
        Args:
            client_id: 可选，指定客户端 ID 进行筛选（0 表示未分配客户端的任务）
        
        Returns:
            运行中的任务列表
        """
        params = {'status': 'running', 'clientId': client_id}
        result = self._request('GET', '/api/task', params=params)
        data = result.get('data', [])
        return [Task.from_dict(item) for item in data]
    
    def get_task(self, task_id: int) -> Optional[Task]:
        """
        获取任务详情
        
        Args:
            task_id: 任务 ID
            
        Returns:
            任务对象，如果不存在返回 None
        """
        result = self._request('GET', f'/api/task/{task_id}')
        data = result.get('data')
        if not data:
            raise ApiException(404, "任务不存在")
        return Task.from_dict(data)

    def update_task_flow(
        self, 
        task_id: int, 
        flow_status: Optional[str] = None, 
        flow: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        更新任务的 flow 状态和 flow 数据（只更新非 None 的字段）
        
        Args:
            task_id: 任务 ID
            flow_status: flow 状态（可选）
            flow: flow 数据（可选）
            
        Returns:
            是否更新成功
        """
        try:
            self._request(
                'PUT',
                f'/api/task/{task_id}/flow',
                json_data={'flow_status': flow_status, 'flow': flow}
            )
            logger.info(f"更新任务 flow 成功: task_id={task_id}, flow_status={flow_status}")
            return True
        except ApiException as e:
            logger.warning(f"更新任务 flow 失败: {e.message}")
            return False

    # ==================== 客户端相关 API ====================
    def sync_client(self, client_id: int, instance_uuid: str) -> Dict[str, Any]:
        """
        客户端心跳同步
        
        Args:
            client_id: 客户端 ID
            instance_uuid: 客户端实例的唯一标识UUID
            
        Returns:
            同步结果
            
        Raises:
            ApiException: 心跳同步失败（如实例冲突返回409）
        """
        result = self._request(
            'POST', 
            f'/api/client/{client_id}/heartbeat',
            json_data={'instance_uuid': instance_uuid}
        )
        return result.get('data', {})


    def get_client_config(self, client_id: int) -> Dict[str, Any]:
        """
        获取客户端配置

        Args:
            client_id: 客户端 ID

        Returns:
            客户端配置信息
        """
        result = self._request('GET', f'/api/client/{client_id}/config')
        return result.get('data', {})

    def update_repo_default_branch(
        self, repo_id: int, default_branch: str
    ) -> bool:
        """
        更新仓库的默认主分支

        Args:
            repo_id: 仓库配置 ID
            default_branch: 默认分支名称

        Returns:
            是否更新成功
        """
        try:
            self._request(
                'PATCH',
                f'/api/client/{self.client_id}/repos/{repo_id}/default-branch',
                json_data={'default_branch': default_branch}
            )
            logger.info(f"更新仓库默认分支成功: repo_id={repo_id}, branch={default_branch}")
            return True
        except ApiException as e:
            logger.warning(f"更新仓库默认分支失败: {e.message}")
            return False


class ApiException(Exception):
    """API 调用异常"""

    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")
