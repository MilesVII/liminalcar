import * as THREE from "three";
import { BufferGeometry, Vector2, Vector3 } from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

main();

type Pixol = {
	r: number,
	g: number,
	b: number
};
type Slice = {
	data: (Pixol | null)[],
	dims: {
		w: number,
		h: number
	}
};

function chonks<T>(src: Array<T>, length: number): T[][]{
	let r = [];
	for (let i = 0; i < src.length; i += length) r.push(src.slice(i, i + length))
	return r;
}

async function loadSlice(path: string): Promise<Slice> {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	const image = new Image();

	await new Promise<void>(resolve => {
		image.onload = () => resolve();
		image.src = path;
	});

	canvas.width = image.width;
	canvas.height = image.height;
	ctx?.drawImage(image, 0, 0);
	const data = Array.from(ctx?.getImageData(0, 0, image.width, image.height).data || []);
	const pixols : (Pixol | null)[] = chonks<number>(data, 4).map(p => p[3] == 0 ? null : ({r : p[0] / 255, g: p[1] / 255, b: p[2] / 255}));

	return {
		data: pixols,
		dims: {
			w: image.width,
			h: image.height
		}
	};
}

function slicesToVoxels(slices: Slice[]): THREE.Mesh {
	const gDash: BufferGeometry[] = [];
	const material = new THREE.MeshLambertMaterial({ vertexColors: true });

	slices.forEach((slice, x) => {
		chonks(slice.data, slice.dims.w).reverse().forEach((row, y) => {
			row.forEach((px, z) => {
				if (px == null) return;
				const color = new THREE.Color(px.r, px.g, px.b);
				const geometry = new THREE.BoxGeometry(1, 1, 1);
				geometry.translate(x, y, z);

				const positionAttribute = geometry.getAttribute("position");
				const colors = [];
				for (let _ = 0; _ < positionAttribute.count; _ += 3) {
					colors.push( color.r, color.g, color.b );
					colors.push( color.r, color.g, color.b );
					colors.push( color.r, color.g, color.b );
				}
				geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

				gDash.push(geometry);
			});
		});
	});

	const g = BufferGeometryUtils.mergeBufferGeometries(gDash);

	return new THREE.Mesh(g, material);
}

function cctvPole(thickness: number, height: number, gab: number, plateFrame: THREE.Vector2, plateAngle: number, color: THREE.Color, display?: THREE.Mesh, camera?: THREE.Camera, lights?: THREE.SpotLight[]): THREE.Group {
	const epsilon = .1;
	const pole = new THREE.BoxGeometry(thickness, height, thickness);
	const handle = new THREE.BoxGeometry(thickness, thickness, gab);
	const plate = new THREE.BoxGeometry(plateFrame.x, plateFrame.y, thickness);
	const mat = new THREE.MeshLambertMaterial({color: color});
	const m0 = new THREE.Mesh(pole, mat);
	const m1 = new THREE.Mesh(handle, mat);
	const m2 = new THREE.Mesh(plate, mat);

	m0.castShadow = true;
	m1.castShadow = true;
	m2.receiveShadow = true;
	
	const plateGroup = new THREE.Group;
	plateGroup.add(m2);
	if (display){
		display.position.z = thickness * .5 + epsilon;
		plateGroup.add(display);
	}
	if (camera){
		camera.rotateY(Math.PI);
		camera.position.z = thickness * .5 + epsilon * 2;
		plateGroup.add(camera);
	}
	if (lights){
		lights.forEach((l, i) => {
			l.position.x = i / lights.length * plateFrame.x - plateFrame.x * .5;
			l.position.z = thickness * .5;
			l.position.y = - plateFrame.y * .49;
			const t = l.position;
			l.target.position.set(t.x, t.y, t.z + 1);
			plateGroup.add(l);
			plateGroup.add(l.target);
			
			l.castShadow = true;
			l.shadow.mapSize.width = 1024;
			l.shadow.mapSize.height = 1024;
		});
	}

	m0.translateY(height * .5);
	m1.translateZ(gab * .5);
	m1.translateY(height);
	plateGroup.translateY(height);
	plateGroup.translateZ(gab);
	plateGroup.rotateX(plateAngle);

	const g = new THREE.Group();
	g.add(m0, m1, plateGroup);
	return g;
}

type State = {
	keyboard: any,
	scene: THREE.Scene,
	camera: THREE.Camera,
	cameraAngle: number,
	renderer: THREE.WebGLRenderer,
	car: {
		speed: number,
		steering: number,
		group: THREE.Group,
		dims: Vector3
	},
	cctv: {
		camera: THREE.Camera,
		rt: THREE.WebGLRenderTarget
	}
};

async function main(){
	const [side, semiddle, middle] = await Promise.all([
		loadSlice("assets/side.png"),
		loadSlice("assets/semiddle.png"),
		loadSlice("assets/middle.png")
	]);

	const renderer = new THREE.WebGLRenderer();
	renderer.shadowMap.enabled = true;
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);
	
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
	const skyLight = new THREE.Color(.1, .0, .0);
	scene.background = skyLight;

	const moon = new THREE.DirectionalLight(skyLight, .7);
	moon.position.set(1000, 100, 10);
	scene.add(moon);

	const terrainTexture = new THREE.TextureLoader().load("assets/terrain.jpg");
	terrainTexture.wrapS = THREE.RepeatWrapping;
	terrainTexture.wrapT = THREE.RepeatWrapping;
	terrainTexture.repeat.set(32, 32);
	const terrainMaterial = new THREE.MeshLambertMaterial({map : terrainTexture});
	const terrain = new THREE.Mesh(new THREE.PlaneGeometry(2048, 2048), terrainMaterial);
	terrain.material.side = THREE.DoubleSide;
	terrain.rotation.x = Math.PI * .5;
	terrain.receiveShadow = true;
	scene.add(terrain);

	const cubes = slicesToVoxels([side, semiddle, middle, middle, middle, semiddle, side]);
	cubes.castShadow = true;
	cubes.receiveShadow = true;
	const group = new THREE.Group();
	group.add(cubes);

	const carBox = new THREE.Box3().setFromObject(group);
	const carCenter = new Vector3();
	carBox.getCenter(carCenter);
	group.translateX(-carCenter.x);
	group.translateZ(-carCenter.z);
	group.translateY(.5);
	const g2 = new THREE.Group();
	g2.add(group);

	const dims = carBox.max.clone().sub(carBox.min);

	const headlights = [
		new THREE.SpotLight(new THREE.Color(.9, .9, 1), 2.7, 100, Math.PI * .32),
		new THREE.SpotLight(new THREE.Color(.9, .9, 1), 2.7, 100, Math.PI * .32)
	];
	headlights[0].position.set(0, carCenter.y, 0);
	headlights[1].position.set(carBox.max.x - 1, carCenter.y, 0);
	headlights.forEach(h => {
		const t = h.position;
		h.target.position.set(t.x, t.y, t.z - 1);
		h.castShadow = true;
	});
	group.add(...headlights);
	group.add(...headlights.map(h => h.target));

	setCameraPosition(camera, 0, dims.z * 2, dims.y * 2, carCenter);

	group.add(camera);
	scene.add(g2);

	const cctvFrame = new Vector2(420, 200);
	const cctvDisplay = new Vector2(65, 32);

	const cctvRT = new THREE.WebGLRenderTarget(cctvFrame.x, cctvFrame.y);
	const cctvDisplayPlane = new THREE.Mesh(new THREE.PlaneGeometry(63, 30), new THREE.MeshBasicMaterial({map : cctvRT.texture}));
	cctvDisplayPlane.material.side = THREE.DoubleSide;

	const cctv = new THREE.PerspectiveCamera(75, cctvFrame.x / cctvFrame.y, 0.1, 1000);

	const cctvAngle = Math.PI * .2;
	const cctvLights = [
		new THREE.SpotLight(new THREE.Color(.9, .9, 1), 1.3, 400, Math.PI * .32),
		new THREE.SpotLight(new THREE.Color(.9, .9, 1), 1.3, 400, Math.PI * .32),
		new THREE.SpotLight(new THREE.Color(.9, .9, 1), 1.3, 400, Math.PI * .32)
	];
	const cctvPoleGroup = cctvPole(2, 42, 12, cctvDisplay, cctvAngle, new THREE.Color(.42, .42, .42), cctvDisplayPlane, cctv, cctvLights);
	cctvPoleGroup.position.set(0, 0, -64);
	cctvPoleGroup.rotateY(Math.PI * .2);
	scene.add(cctvPoleGroup);

	const keyboardState: any = {};
	function keyEvent(isDown: boolean, keyCode: string): void {
		keyboardState[keyCode] = isDown;
	}
	window.addEventListener("keydown", e => keyEvent(true, e.code), false);
	window.addEventListener("keyup", e => keyEvent(false, e.code), false);

	const state: State = {
		keyboard: keyboardState,
		scene,
		camera,
		cameraAngle: 0,
		renderer,
		car: {
			speed: 0,
			steering: 0,
			group: g2,
			dims
		},
		cctv: {
			camera: cctv,
			rt: cctvRT
		}
	};
	mainloop(state);
}

function moveTowardsZero(value: number, offset: number){
	if (Math.abs(value) < offset) return 0;
	if (value > 0)
		return value - offset;
	else
		return value + offset;
}

function setCameraPosition(camera: THREE.Camera, angle: number, radius: number, height: number, target: THREE.Vector3): void{
	camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
	camera.lookAt(target);
}

function mainloop(state: State){
	requestAnimationFrame(() => mainloop(state));

	const acceleration = .01;
	const deceleration = .006;
	const maxSpeed = 1;

	const steeringPower = .001;
	const desteeringPower = steeringPower * .7;
	const steeringMax = Math.PI * .02;

	if (state.keyboard["KeyW"] || state.keyboard["KeyS"]){
		if (state.keyboard["KeyW"])
			state.car.speed += acceleration;
		else
			state.car.speed -= acceleration;
	} else {
		state.car.speed = moveTowardsZero(state.car.speed, deceleration);
	}
	state.car.speed = THREE.MathUtils.clamp(state.car.speed, -maxSpeed, maxSpeed);

	if (state.keyboard["KeyA"]) state.car.steering += steeringPower;
	if (state.keyboard["KeyD"]) state.car.steering -= steeringPower;
	state.car.steering = THREE.MathUtils.clamp(state.car.steering, -steeringMax, steeringMax);
	state.car.group.rotateY(state.car.steering * state.car.speed);
	state.car.steering = moveTowardsZero(state.car.steering, desteeringPower);

	const direction = new Vector3();
	state.car.group.getWorldDirection(direction);
	state.car.group.position.addScaledVector(direction, -state.car.speed);

	const lastCameraAngle = state.cameraAngle;
	if (state.keyboard["KeyQ"]) state.cameraAngle += .042;
	if (state.keyboard["KeyE"]) state.cameraAngle -= .042;
	if (lastCameraAngle != state.cameraAngle){
		const carBox = new THREE.Box3().setFromObject(state.car.group.children[0]);
		const carCenter = new Vector3();
		carBox.getCenter(carCenter);
		setCameraPosition(state.camera, state.cameraAngle, state.car.dims.z * 2, state.car.dims.y * 2, carCenter);
	}

	state.renderer.setRenderTarget(state.cctv.rt);
	state.renderer.render(state.scene, state.cctv.camera);
	state.renderer.setRenderTarget(null);
	state.renderer.render(state.scene, state.camera);
	//console.log(state.renderer.info.render.calls)
}
