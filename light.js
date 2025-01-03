import {multiply4, invert4, rotate4, translate4} from "./matrixOperations.js";
import {cameras, getViewMatrix, perspectiveLight, orthographicLight} from "./cameras.js"
import {createProgram} from "./webGLFuncs.js";

class TransformNode
{ 
    constructor() {
        this._position = new Vector3D,
        this._rotation = new Quaternion
    }
    get position() {
        return this._position
    }
    set position(v) {
        this._position.equals(v)
    }
    get rotation() {
        return this._rotation
    }
    set rotation(q) {
        this._rotation.equals(q)
    }
}

// Asumed immovable
export class LightSource
{
	constructor(type, R, t, width = 1024, height = 923)
	{	
        
        this.detphIndexBuffer;
        this.vertexShader;
        this.fragmentShader;

		this.camToWorld = [
				[R[0], R[1], R[2], 0],
		        [R[3], R[4], R[5], 0],
		        [R[6], R[7], R[8], 0],
		        [
		            -t[0] * R[0] - t[1] * R[3] - t[2] * R[6],
		            -t[0] * R[1] - t[1] * R[4] - t[2] * R[7],
		            -t[0] * R[2] - t[1] * R[5] - t[2] * R[8],
		            1,
		        ]
		        ].flat();

		this.view = this.camToWorld;//invert4(this.camToWorld);

        let getProjectionMatrix;
        let tempVertexShader;
		if(type = 0)
		{
            getProjectionMatrix = orthographicLight.getProjectionMatrix;
            tempVertexShader = orthographicLight.vertexShaderSource;
		}
		if(type = 1)
		{
			getProjectionMatrix = perspectiveLight.getProjectionMatrix;
            tempVertexShader = perspectiveLight.vertexShaderSource;
		}

        this.proj = getProjectionMatrix(width, height);
		this.worldToScreen = multiply4(this.proj, this.view); // Problem
		
        this.vertexSource = tempVertexShader;
        this.fragmentSource = `
                #version 300 es
                precision highp float;
                precision highp int;

                in vec2 vPosition;
                in float zPos;
                in float alpha;
                out vec4 fragColor;

                void main () {

                    float A = -dot(vPosition, vPosition);
                    
                    if (A < -4.) discard;

                    float B = exp(A) * alpha;
                    
                    // Depth camera
                    fragColor = vec4(vec3(B * zPos), B);

                    // Depth screen
                    //fragColor = vec4(vec3(gl_FragCoord.z * B), B);
                }

                `.trim();


        this.fbo;
        this.gaussianDepthMap;
        this.depthBuffer;
        this.depthTextures;
        this.gaussianVAO;
        this.gaussianFBO;
        //this.gaussianDepthBuffer;
        this.indexBuffer;

        this.gaussianProgram;
        this.vertexBuffer;

        this.width = width;
        this.height = height;
        
        this.u_projection;
        this.u_viewport;
        this.u_view;
        this.u_textureLocation;

        this.triangleVertices = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]);


        this.gl;
	}


    runSort(viewProj, buffer, vertexCount) {
        const f_buffer = new Float32Array(buffer);
        const lastVertexCount = vertexCount;

        let maxDepth = -Infinity;
        let minDepth = Infinity;
        let sizeList = new Int32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            let depth =
                ((viewProj[2] * f_buffer[8 * i + 0] +
                    viewProj[6] * f_buffer[8 * i + 1] +
                    viewProj[10] * f_buffer[8 * i + 2]) *
                    4096) |
                0;
            sizeList[i] = depth;
            if (depth > maxDepth) maxDepth = depth;
            if (depth < minDepth) minDepth = depth;
        }

        // This is a 16 bit single-pass counting sort
        let depthInv = (256 * 256) / (maxDepth - minDepth);
        let counts0 = new Uint32Array(256 * 256);
        for (let i = 0; i < vertexCount; i++) {
            sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
            counts0[sizeList[i]]++;
        }
        let starts0 = new Uint32Array(256 * 256);
        for (let i = 1; i < 256 * 256; i++)
            starts0[i] = starts0[i - 1] + counts0[i - 1];
        const depthIndex = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++)
            depthIndex[starts0[sizeList[i]]++] = i;


        this.detphIndexBuffer = depthIndex.buffer;
    }


    updateGaussians(buffer, vertexCount)
    {
        const gl = this.gl;
        // -------------------------------- Render gaussian plane
        // single render call
        console.log('updating');
        this.runSort(this.worldToScreen, buffer, vertexCount);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.gaussianFBO);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); 
        gl.bindVertexArray(this.gaussianVAO);
        gl.useProgram(this.gaussianProgram);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.detphIndexBuffer, gl.DYNAMIC_DRAW);

        //gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
        //gl.depthFunc(gl.ALWAYS);
        //gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
                gl.ONE_MINUS_DST_ALPHA,
                gl.ONE,
                gl.ONE_MINUS_DST_ALPHA,
                gl.ONE,
            );
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
            

        gl.viewport(0, 0, this.width, this.height);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, vertexCount);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }


    build(gl)
    {
        // Construct the buffers

        /*
            Sort the gaussians one time and save the indices
            Create the shaders
            Set the variables for the shaders 1 time (they do not change)

            Set the depth and color buffer. Both buffers create a depth map

            
        */
        // Make a depth buffer of the gaussians and save it to a texture
        this.gl = gl;

        this.gaussianFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.gaussianFBO);
        // Tell WebGL how to convert from clip space to pixels
        gl.viewport(0, 0, this.width, this.height);


        // Create a texture for the color buffer.
        this.gaussianDepthMap = gl.createTexture();

        // make unit i the active texture unit
        gl.activeTexture(gl.TEXTURE0 + 5); // Hard coded

        // Bind texture to 'texture unit i' 2D bind point
        gl.bindTexture(gl.TEXTURE_2D, this.gaussianDepthMap);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        // Bind the texture as where color is going to be written
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gaussianDepthMap, 0);

/*
        // Depth buffer

        this.gaussianDepthBuffer = gl.createRenderbuffer();

        // Bind texture to 'texture unit i' 2D bind point
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.gaussianDepthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.gaussianDepthBuffer);

*/
        // Check framebuffer completeness
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer not complete');
        }

        // --------------------- Building gaussian renderer -------------

        this.gaussianVAO = gl.createVertexArray();
        gl.bindVertexArray(this.gaussianVAO);



        this.gaussianProgram = createProgram(gl, this.vertexSource, this.fragmentSource);
        gl.linkProgram(this.gaussianProgram);
        gl.useProgram(this.gaussianProgram);
        this.u_projection = gl.getUniformLocation(this.gaussianProgram, "projection");
        this.u_viewport = gl.getUniformLocation(this.gaussianProgram, "viewport");
        this.u_view = gl.getUniformLocation(this.gaussianProgram, "view");
        this.u_textureLocation = gl.getUniformLocation(this.gaussianProgram, "u_texture");

        gl.uniform2fv(this.u_viewport, new Float32Array([this.width, this.height]));
        gl.uniformMatrix4fv(this.u_projection, false, this.proj);
        gl.uniformMatrix4fv(this.u_view, false, this.view);
        gl.uniform1i(this.u_textureLocation, 0); // The gaussian texture

        // positions
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.triangleVertices, gl.STATIC_DRAW);
        const a_position = gl.getAttribLocation(this.gaussianProgram, "position");
        gl.enableVertexAttribArray(a_position);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);


        this.indexBuffer = gl.createBuffer();
        const a_index = gl.getAttribLocation(this.gaussianProgram, "index");
        gl.enableVertexAttribArray(a_index);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
        gl.vertexAttribIPointer(a_index, 1, gl.INT, false, 0, 0);
        gl.vertexAttribDivisor(a_index, 1);

        // ----------------------- End ------------------------
  


        /* ----------------------- Create the final renderer ------------------------- */
        
        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        // Tell WebGL how to convert from clip space to pixels
        gl.viewport(0, 0, this.width, this.height);
        
        this.depthTextures = gl.createTexture();

        // make unit i the active texture unit
        gl.activeTexture(gl.TEXTURE0 + 6); // Hard coded

        // Bind texture to 'texture unit i' 2D bind point
        gl.bindTexture(gl.TEXTURE_2D, this.depthTextures);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        
        // Will render to this one every frame
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.depthTextures, 0);

        this.depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);


        
        /* --------------------------------- End ------------------------------------- */

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    clean()
    {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);   
    }
    render(obj) // Ideally, we want the meshes to be an object with an asociated program and vao
    {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.bindVertexArray(obj.VAO);
        gl.useProgram(obj.Program);
        // Usees the same logic to render normal objects

        gl.uniformMatrix4fv(obj.projection, false, this.proj);
        gl.uniformMatrix4fv(obj.view, false, this.view);

        gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

        // REturns a texture where R and G have depth information for the shadows

        // This allows us to wait for it to finish rendering before anything else (not doing that now tho)

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);   
    }

    buildShadowsDepthBuffer()
    {
        // Hard coded xdd
    }


}